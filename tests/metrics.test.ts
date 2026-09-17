import { describe, expect, it } from "vitest";
import { summarizeDispatchPerformance } from "../netlify/functions/_shared/metrics";
import type { Booking } from "../netlify/functions/_shared/types";

function booking(overrides: Partial<Booking>): Booking {
  return {
    id: crypto.randomUUID(), version: 1, status: "pending", type: "delivery", priority: "normal",
    requester: "Foreman", requesterEmail: "foreman@example.com", requesterId: "member-1",
    site: "Grand & Fir", pickupLocation: "Supplier", description: "Material", date: "2026-09-17",
    time: "08:00", notes: "", supplier: "", poNumber: "", siteContact: "", loadSize: "small",
    readyConfirmed: true, brentNotes: "", assignedTo: "", vehicle: "", durationMinutes: 60,
    photoId: null, estCost: 100, estMinutes: 60, estKm: 20, bundleRequested: false,
    bundleStatus: "none", bundleWithId: null, createdAt: "2026-09-17T15:00:00.000Z",
    updatedAt: "2026-09-17T15:00:00.000Z", ...overrides,
  };
}

describe("dispatch performance summary", () => {
  it("shows ownership gaps, approval speed, actual capture and savings", () => {
    const result = summarizeDispatchPerformance([
      booking({ status: "pending" }),
      booking({ status: "approved", approvedAt: "2026-09-17T15:30:00.000Z" }),
      booking({ status: "in-progress", assignedTo: "Alex", approvedAt: "2026-09-17T16:00:00.000Z" }),
      booking({ status: "completed", assignedTo: "Brent", approvedAt: "2026-09-17T15:15:00.000Z", actualMinutes: 50, actualKm: 18, actualCost: 80 }),
    ]);

    expect(result).toMatchObject({
      pending: 1, active: 1, unassigned: 1, completed: 1, actualsRecorded: 1,
      actualCaptureRate: 100, avgApprovalMinutes: 35,
      estimatedMeasuredCost: 100, actualMeasuredCost: 80, costVariance: -20, measuredSavings: 20,
    });
  });

  it("does not claim savings when completed work lacks actuals", () => {
    expect(summarizeDispatchPerformance([booking({ status: "completed" })])).toMatchObject({
      completed: 1, actualsRecorded: 0, actualCaptureRate: 0,
      estimatedMeasuredCost: 0, actualMeasuredCost: 0, measuredSavings: 0,
    });
  });
});
