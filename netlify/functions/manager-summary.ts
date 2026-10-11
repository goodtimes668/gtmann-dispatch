import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { handleError, HttpError, json } from "./_shared/http";
import { listBookings } from "./_shared/stores";
import type { Booking } from "./_shared/types";
import { isISODate } from "./_shared/validation";

type SiteSummary = {
  count: number;
  cost: number;
  declined: number;
  urgent: number;
  bundled: number;
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

function buildOwnerReport(params: {
  bookings: Booking[];
  cost: number;
  completed: number;
  urgentOpen: number;
  pending: number;
  unassignedActive: number;
  overdueReturns: number;
  matchedSavings: number;
  potentialSavings: number;
  avgApprovalHours: number | null;
  busiestSite: string;
}) {
  const bullets = [
    `${params.bookings.length} dispatch request${params.bookings.length === 1 ? "" : "s"} in the selected range with $${Math.round(params.cost)} estimated dispatch cost.`,
    `${params.completed} completed dispatch${params.completed === 1 ? "" : "es"}; ${params.pending} awaiting approval; ${params.urgentOpen} urgent still open.`,
    `${params.unassignedActive} approved or in-progress dispatch${params.unassignedActive === 1 ? "" : "es"} still need a driver or truck assigned.`,
    `$${Math.round(params.matchedSavings)} estimated savings protected from matched bundled trips; $${Math.round(params.potentialSavings)} more is waiting in queued bundle requests.`,
  ];
  if (params.avgApprovalHours !== null) bullets.push(`Average approval time is ${params.avgApprovalHours.toFixed(1)} hours.`);
  if (params.busiestSite) bullets.push(`${params.busiestSite} is the busiest jobsite for this range.`);
  if (params.overdueReturns) bullets.push(`${params.overdueReturns} equipment return${params.overdueReturns === 1 ? " is" : "s are"} overdue.`);

  const nextActions = [];
  if (params.pending) nextActions.push("Clear pending approvals before the next dispatch window.");
  if (params.unassignedActive) nextActions.push("Assign a driver and truck to active approved work.");
  if (params.potentialSavings) nextActions.push("Bundle queued non-urgent trips with the next site run.");
  if (params.overdueReturns) nextActions.push("Recover overdue equipment returns.");
  if (!nextActions.length) nextActions.push("Keep tracking requests so the savings number can be shown weekly.");

  return {
    headline: `Dispatch report: ${params.bookings.length} requests, $${Math.round(params.cost)} cost, $${Math.round(params.matchedSavings)} saved`,
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
    const bookings = (await listBookings()).filter((booking) => (!from || booking.date >= from) && (!to || booking.date <= to));
    const sites: Record<string, SiteSummary> = {};

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
    let matchedSavings = 0;
    let potentialSavings = 0;
    const approvalHours: number[] = [];
    const completionDays: number[] = [];

    for (const booking of bookings) {
      const amount = bookingCost(booking);
      const key = booking.site || "(No Site)";
      sites[key] ||= { count: 0, cost: 0, declined: 0, urgent: 0, bundled: 0 };
      sites[key].count += 1;

      if (booking.status === "declined") {
        declined += 1;
        sites[key].declined += 1;
      } else {
        cost += amount;
        sites[key].cost += amount;
      }

      if (booking.status === "completed") completed += 1;
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
        if (booking.status !== "declined") matchedSavings += amount;
      }
      if (booking.bundleStatus === "queued") {
        bundleQueued += 1;
        if (booking.status !== "declined" && booking.status !== "completed") potentialSavings += amount;
      }

      const approval = hoursBetween(booking.createdAt, booking.approvedAt);
      if (approval !== null) approvalHours.push(approval);
      const completion = daysBetween(booking.createdAt, booking.completedAt);
      if (completion !== null) completionDays.push(completion);
    }

    const bySite = Object.entries(sites)
      .map(([name, value]) => ({ name, ...value, cost: roundMoney(value.cost) }))
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
      matchedSavings,
      potentialSavings,
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
      estimatedSavings: roundMoney(matchedSavings),
      potentialSavings: roundMoney(potentialSavings),
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
