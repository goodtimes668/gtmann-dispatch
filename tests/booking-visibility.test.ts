import { describe, expect, it } from "vitest";
import { publicBooking } from "../netlify/functions/bookings";
import type { Booking } from "../netlify/functions/_shared/types";

const booking = {
  id: "booking-1",
  requesterId: "member-1",
  requesterEmail: "member@example.com",
  status: "completed",
  photoId: null,
  completionPhotoId: null,
  estCost: 42.5,
  actualCost: 39.25,
  estMinutes: 60,
  estKm: 20,
} as unknown as Booking;

describe("booking cost visibility", () => {
  it("shows estimated and actual costs to managers", () => {
    expect(publicBooking(booking, { id: "manager-1", roles: ["manager"] })).toMatchObject({ estCost: 42.5, actualCost: 39.25 });
  });

  it("removes estimated and actual costs from dispatcher responses", () => {
    const result = publicBooking(booking, { id: "dispatcher-1", roles: ["dispatcher"] });
    expect(result).not.toHaveProperty("estCost");
    expect(result).not.toHaveProperty("actualCost");
  });

  it("removes estimated and actual costs from member responses", () => {
    const result = publicBooking(booking, { id: "member-1", roles: ["member"] });
    expect(result).not.toHaveProperty("estCost");
    expect(result).not.toHaveProperty("actualCost");
  });
});
