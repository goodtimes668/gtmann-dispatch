import { describe, expect, it } from "vitest";
import { buildApprovalCalendar } from "../netlify/functions/_shared/calendar-email";
import type { Booking } from "../netlify/functions/_shared/types";

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "booking-123",
    version: 2,
    status: "approved",
    type: "delivery",
    priority: "normal",
    requester: "Ryan Jones",
    requesterEmail: "ryan@example.com",
    requesterId: "user-1",
    site: "Grand & Fir",
    pickupLocation: "Faithwood Farms",
    description: "Deliver formwork",
    date: "2026-09-01",
    time: "13:30",
    notes: "Call on arrival",
    brentNotes: "Use the flat deck",
    photoId: null,
    estCost: 42,
    estMinutes: 60,
    estKm: 20,
    bundleRequested: false,
    bundleStatus: "none",
    bundleWithId: null,
    createdAt: "2026-08-31T18:00:00.000Z",
    updatedAt: "2026-08-31T18:05:00.000Z",
    approvedAt: "2026-08-31T18:05:00.000Z",
    ...overrides,
  };
}

describe("approval calendar attachment", () => {
  it("creates a one-hour Vancouver-time event for timed bookings", () => {
    const calendar = buildApprovalCalendar(booking());
    expect(calendar).toContain("DTSTART;TZID=America/Vancouver:20260901T133000");
    expect(calendar).toContain("DTEND;TZID=America/Vancouver:20260901T143000");
    expect(calendar).toContain("SUMMARY:GT Mann Dispatch - Material Delivery - Grand & Fir");
    expect(calendar).toContain("STATUS:CONFIRMED");
  });

  it("creates an all-day event when no booking time is provided", () => {
    const calendar = buildApprovalCalendar(booking({ time: "" }));
    expect(calendar).toContain("DTSTART;VALUE=DATE:20260901");
    expect(calendar).toContain("DTEND;VALUE=DATE:20260902");
    expect(calendar).not.toContain("BEGIN:VTIMEZONE");
  });

  it("escapes user-entered calendar text", () => {
    const calendar = buildApprovalCalendar(booking({
      site: "Site, A; North",
      description: "First line\nSecond line",
    }));
    expect(calendar).toContain("LOCATION:Site\\, A\\; North");
    expect(calendar).toContain("Description: First line\\nSecond line");
  });

  it("rolls the event end into the next day", () => {
    const calendar = buildApprovalCalendar(booking({ time: "23:30" }));
    expect(calendar).toContain("DTEND;TZID=America/Vancouver:20260902T003000");
  });
});
