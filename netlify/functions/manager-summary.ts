import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { handleError, HttpError, json } from "./_shared/http";
import { listBookings, listSites } from "./_shared/stores";
import type { Booking, Site } from "./_shared/types";
import { isISODate } from "./_shared/validation";

type SiteSummary = {
  count: number;
  cost: number;
  declined: number;
  urgent: number;
  bundled: number;
  proof: number;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function hoursBetween(start?: string, end?: string) {
  const a = Date.parse(start || "");
  const b = Date.parse(end || "");
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? (b - a) / 36e5 : null;
}

function daysBetween(start?: string, end?: string) {
  const hours = hoursBetween(start, end);
  return hours === null ? null : hours / 24;
}

function bookingCost(booking: Booking) {
  return typeof booking.estCost === "number" && Number.isFinite(booking.estCost) ? booking.estCost : 0;
}

function normalizeSiteName(value: string) {
  return value.trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function titleCaseSite(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function siteLookup(sites: Site[]) {
  const lookup = new Map<string, string>();
  for (const site of sites) {
    const key = normalizeSiteName(site.name);
    if (key) lookup.set(key, site.name);
  }
  return lookup;
}

function buildOwnerReport(params: {
  bookings: Booking[];
  cost: number;
  completed: number;
  urgentOpen: number;
  pending: number;
  unassignedActive: number;
  overdueReturns: number;
  matchedBundleCost: number;
  queuedBundleCost: number;
  completionProofs: number;
  avgApprovalHours: number | null;
  busiestSite: string;
}) {
  const bullets = [
    `${params.bookings.length} dispatch request${params.bookings.length === 1 ? "" : "s"} in the selected range with $${Math.round(params.cost)} estimated dispatch cost.`,
    `${params.completed} completed dispatch${params.completed === 1 ? "" : "es"}; ${params.pending} awaiting approval; ${params.urgentOpen} urgent still open.`,
    `${params.completionProofs} completed dispatch${params.completionProofs === 1 ? " has" : "es have"} receiver notes, sign-off, or photo proof attached.`,
    `${params.unassignedActive} approved or in-progress dispatch${params.unassignedActive === 1 ? "" : "es"} still need a driver or truck assigned.`,
    `$${Math.round(params.matchedBundleCost)} estimated trip cost across matched bundle requests; $${Math.round(params.queuedBundleCost)} estimated trip cost across queued bundle requests.`,
  ];
  if (params.avgApprovalHours !== null) bullets.push(`Average approval time is ${params.avgApprovalHours.toFixed(1)} hours.`);
  if (params.busiestSite) bullets.push(`${params.busiestSite} is the busiest jobsite for this range.`);
  if (params.overdueReturns) bullets.push(`${params.overdueReturns} equipment return${params.overdueReturns === 1 ? " is" : "s are"} overdue.`);

  const nextActions = [];
  if (params.pending) nextActions.push("Clear pending approvals before the next dispatch window.");
  if (params.unassignedActive) nextActions.push("Assign a driver and truck to active approved work.");
  if (params.queuedBundleCost) nextActions.push("Review queued bundle requests and confirm which trips can share a site run.");
  if (params.overdueReturns) nextActions.push("Recover overdue equipment returns.");
  if (!nextActions.length) nextActions.push("Keep tracking estimated dispatch costs and completed work weekly.");

  return {
    headline: `Dispatch report: ${params.bookings.length} requests, $${Math.round(params.cost)} cost, $${Math.round(params.matchedBundleCost)} matched trip cost`,
    bullets,
    nextActions,
  };
}

export default async (req: Request, _context: Context) => {
  try {
    await requireUser(["manager"]);
    const url = new URL(req.url);
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    if ((from && !isISODate(from)) || (to && !isISODate(to)) || (from && to && from > to)) {
      throw new HttpError(422, "Invalid date range");
    }

    const today = new Date().toISOString().slice(0, 10);
    const [bookings, savedSites] = await Promise.all([
      listBookings().then((items) => items.filter((booking) => (!from || booking.date >= from) && (!to || booking.date <= to))),
      listSites(),
    ]);
    const savedSiteNames = siteLookup(savedSites);
    const sites: Record<string, SiteSummary> = {};
    const siteNames: Record<string, string> = {};

    let cost = 0;
    let declined = 0;
    let completed = 0;
    let urgentOpen = 0;
    let pending = 0;
    let active = 0;
    let slackCreated = 0;
    let assigned = 0;
    let unassignedActive = 0;
    let returnOpen = 0;
    let overdueReturns = 0;
    let bundleMatched = 0;
    let bundleQueued = 0;
    let matchedBundleCost = 0;
    let queuedBundleCost = 0;
    let completionProofs = 0;
    const approvalHours: number[] = [];
    const completionDays: number[] = [];

    for (const booking of bookings) {
      const amount = bookingCost(booking);
      const normalizedSite = normalizeSiteName(booking.site || "");
      const key = normalizedSite || "(No Site)";
      siteNames[key] ||= savedSiteNames.get(normalizedSite) || titleCaseSite(booking.site || "") || "(No Site)";
      sites[key] ||= { count: 0, cost: 0, declined: 0, urgent: 0, bundled: 0, proof: 0 };
      sites[key].count += 1;

      if (booking.status === "declined") {
        declined += 1;
        sites[key].declined += 1;
      } else {
        cost += amount;
        sites[key].cost += amount;
      }

      if (booking.status === "completed") completed += 1;
      if (booking.status === "completed" && (booking.completionPhotoId || booking.completionNotes || booking.receivedBy)) {
        completionProofs += 1;
        sites[key].proof += 1;
      }
      if (booking.status === "pending") pending += 1;
      if (booking.status === "approved" || booking.status === "in-progress") active += 1;
      if (booking.priority === "urgent") sites[key].urgent += 1;
      if (booking.priority === "urgent" && booking.status !== "completed" && booking.status !== "declined") urgentOpen += 1;
      if (booking.source === "slack") slackCreated += 1;
      if (booking.assignedDriver || booking.vehicle) assigned += 1;
      if ((booking.status === "approved" || booking.status === "in-progress") && !booking.assignedDriver && !booking.vehicle) unassignedActive += 1;
      if (booking.returnItem && booking.returnStatus !== "returned") {
        returnOpen += 1;
        if (booking.expectedReturnDate && booking.expectedReturnDate < today) overdueReturns += 1;
      }
      if (booking.bundleStatus === "matched") {
        bundleMatched += 1;
        sites[key].bundled += 1;
        if (booking.status !== "declined") matchedBundleCost += amount;
      }
      if (booking.bundleStatus === "queued") {
        bundleQueued += 1;
        if (booking.status !== "declined" && booking.status !== "completed") queuedBundleCost += amount;
      }

      const approval = hoursBetween(booking.createdAt, booking.approvedAt);
      if (approval !== null) approvalHours.push(approval);
      const completion = daysBetween(booking.createdAt, booking.completedAt);
      if (completion !== null) completionDays.push(completion);
    }

    const bySite = Object.entries(sites)
      .map(([key, value]) => ({ name: siteNames[key] || key, ...value, cost: roundMoney(value.cost) }))
      .sort((a, b) => b.cost - a.cost || b.count - a.count);
    const busiestSite = bySite[0]?.name === "(No Site)" ? "" : bySite[0]?.name || "";
    const avgApproval = average(approvalHours);
    const avgCompletion = average(completionDays);

    const ownerReport = buildOwnerReport({
      bookings,
      cost,
      completed,
      urgentOpen,
      pending,
      unassignedActive,
      overdueReturns,
      matchedBundleCost,
      queuedBundleCost,
      completionProofs,
      avgApprovalHours: avgApproval === null ? null : Math.round(avgApproval * 10) / 10,
      busiestSite,
    });

    return json({
      bookings: bookings.length,
      cost: roundMoney(cost),
      declined,
      completed,
      urgentOpen,
      pending,
      active,
      slackCreated,
      assigned,
      unassignedActive,
      returnOpen,
      overdueReturns,
      bundleMatched,
      bundleQueued,
      matchedBundleCost: roundMoney(matchedBundleCost),
      queuedBundleCost: roundMoney(queuedBundleCost),
      completionProofs,
      avgApprovalHours: avgApproval === null ? null : Math.round(avgApproval * 10) / 10,
      avgCompletionDays: avgCompletion === null ? null : Math.round(avgCompletion * 10) / 10,
      busiestSite,
      bySite,
      ownerReport,
    });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/manager-summary" };
