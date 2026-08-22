import { describe, expect, it } from "vitest";
import { outlookCalendarUrl } from "../netlify/functions/_shared/outlook";
import type { Booking } from "../netlify/functions/_shared/types";

const booking = {
  id: "booking-1",
  version: 2,
  status: "approved",
  requester: "Alex Morgan",
  requesterEmail: "alex@example.com",
  requesterId: "user-1",
  type: "delivery",
  priority: "normal",
  site: "1234 Douglas Street, Victoria, BC",
  pickupLocation: "",
  description: "Deliver concrete anchors",
  date: "2026-08-24",
  time: "09:30",
  notes: "Call on arrival",
  photoId: null,
  bundleRequested: false,
  bundleStatus: "none",
  bundleWithId: null,
  brentNotes: "",
  estMinutes: 75,
  estKm: 20,
  estCost: 80,
  createdAt: "2026-08-22T00:00:00.000Z",
  updatedAt: "2026-08-22T01:00:00.000Z",
} as Booking;

describe("Outlook calendar link", () => {
  it("prefills an approved dispatch with its local date, duration, site, and details", () => {
    const url = new URL(outlookCalendarUrl(booking));
    expect(url.origin).toBe("https://outlook.office.com");
    expect(url.searchParams.get("subject")).toBe("Dispatch – Material Delivery – 1234 Douglas Street, Victoria, BC");
    expect(url.searchParams.get("startdt")).toBe("2026-08-24T09:30:00");
    expect(url.searchParams.get("enddt")).toBe("2026-08-24T10:45:00");
    expect(url.searchParams.get("location")).toBe(booking.site);
    expect(url.searchParams.get("body")).toContain("Deliver concrete anchors");
    expect(url.searchParams.get("allday")).toBe("false");
  });

  it("creates a one-day all-day event when no dispatch time is supplied", () => {
    const url = new URL(outlookCalendarUrl({ ...booking, time: "" }));
    expect(url.searchParams.get("startdt")).toBe("2026-08-24T00:00:00");
    expect(url.searchParams.get("enddt")).toBe("2026-08-25T00:00:00");
    expect(url.searchParams.get("allday")).toBe("true");
  });
});
