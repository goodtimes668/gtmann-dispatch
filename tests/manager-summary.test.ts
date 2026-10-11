import { beforeEach, describe, expect, it, vi } from "vitest";

const { blobs, getUser } = vi.hoisted(() => ({
  blobs: new Map<string, Map<string, { value: unknown }>>(),
  getUser: vi.fn(),
}));

vi.mock("@netlify/blobs", () => ({
  getStore: ({ name }: { name: string }) => {
    if (!blobs.has(name)) blobs.set(name, new Map());
    const data = blobs.get(name)!;
    return {
      get: async (key: string) => data.get(key)?.value ?? null,
      list: async ({ prefix = "" }: { prefix?: string } = {}) => ({
        blobs: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      }),
    };
  },
}));

vi.mock("@netlify/identity", () => ({ getUser, verifyRequestOrigin: vi.fn() }));

import handler from "../netlify/functions/manager-summary";
import type { Booking } from "../netlify/functions/_shared/types";

function putBooking(booking: Partial<Booking> & Pick<Booking, "id" | "date" | "status">) {
  const now = "2026-10-01T12:00:00.000Z";
  const record: Booking = {
    id: booking.id,
    version: 1,
    status: booking.status,
    type: "delivery",
    priority: "normal",
    requester: "Ryan",
    requesterEmail: "ryan@example.com",
    requesterId: "user-1",
    site: "Grand & Fir",
    pickupLocation: "",
    description: "Material run",
    date: booking.date,
    time: "",
    notes: "",
    brentNotes: "",
    photoId: null,
    estCost: 50,
    estMinutes: 45,
    estKm: 16,
    bundleRequested: false,
    bundleStatus: "none",
    bundleWithId: null,
    createdAt: now,
    updatedAt: now,
    ...booking,
  };
  blobs.get("dispatch-bookings")!.set(`booking/${record.id}`, { value: record });
}

beforeEach(() => {
  blobs.clear();
  blobs.set("dispatch-bookings", new Map());
  getUser.mockResolvedValue({ id: "manager-1", email: "manager@example.com", name: "Manager", roles: ["manager"] });
});

describe("manager summary value dashboard", () => {
  it("returns cost totals, bottlenecks, and an owner-ready report", async () => {
    putBooking({ id: "a", date: "2026-10-01", status: "completed", completedAt: "2026-10-02T12:00:00.000Z", approvedAt: "2026-10-01T16:00:00.000Z", estCost: 80 });
    putBooking({ id: "b", date: "2026-10-02", status: "pending", priority: "urgent", source: "slack", estCost: 60 });
    putBooking({ id: "c", date: "2026-10-03", status: "approved", assignedDriver: "", vehicle: "", estCost: 70 });
    putBooking({ id: "d", date: "2026-10-04", status: "approved", bundleRequested: true, bundleStatus: "matched", bundleWithId: "c", estCost: 45 });
    putBooking({ id: "e", date: "2026-10-05", status: "pending", bundleRequested: true, bundleStatus: "queued", estCost: 35 });
    putBooking({ id: "f", date: "2026-10-06", status: "approved", returnItem: "laser", expectedReturnDate: "2000-01-01", returnStatus: "pending", estCost: 20 });
    putBooking({ id: "g", date: "2026-10-07", status: "declined", estCost: 999 });

    const response = await handler(new Request("https://example.com/api/manager-summary?from=2026-10-01&to=2026-10-31"), {} as any);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.bookings).toBe(7);
    expect(body.cost).toBe(310);
    expect(body.declined).toBe(1);
    expect(body.completed).toBe(1);
    expect(body.urgentOpen).toBe(1);
    expect(body.pending).toBe(2);
    expect(body.unassignedActive).toBe(3);
    expect(body.overdueReturns).toBe(1);
    expect(body.slackCreated).toBe(1);
    expect(body.matchedBundleCost).toBe(45);
    expect(body.queuedBundleCost).toBe(35);
    expect(body.avgApprovalHours).toBe(4);
    expect(body.ownerReport.headline).toContain("Dispatch report");
    expect(body.ownerReport.bullets.join(" ")).toContain("$45 estimated trip cost across matched bundle requests");
    expect(body.ownerReport.headline).toContain("$45 matched trip cost");
    expect(body.ownerReport.bullets.join(" ")).not.toContain("savings");
    expect(body.bySite[0]).toMatchObject({ name: "Grand & Fir", count: 7, urgent: 1, bundled: 1 });
  });

  it("rejects non-manager access", async () => {
    getUser.mockResolvedValue({ id: "member-1", email: "member@example.com", roles: ["member"] });
    const response = await handler(new Request("https://example.com/api/manager-summary"), {} as any);
    expect(response.status).toBe(403);
  });
});
