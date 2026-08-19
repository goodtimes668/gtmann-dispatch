import { describe, expect, it } from "vitest";
import { HttpError } from "../netlify/functions/_shared/http";
import { isISODate, validateBookingInput, validateSiteInput } from "../netlify/functions/_shared/validation";

const validBooking = {
  type: "delivery",
  priority: "normal",
  site: "Grand & Fir",
  pickupLocation: "",
  description: "Deliver concrete anchors",
  date: "2026-08-18",
  time: "09:30",
  notes: "",
  photoId: null,
  bundleRequested: false,
};

describe("booking validation", () => {
  it("accepts a complete delivery", () => {
    expect(validateBookingInput(validBooking)).toMatchObject(validBooking);
  });

  it("rejects calendar rollover dates", () => {
    expect(isISODate("2026-02-29")).toBe(false);
    expect(() => validateBookingInput({ ...validBooking, date: "2026-02-29" })).toThrow(HttpError);
  });

  it("requires a pickup location for pickup jobs", () => {
    expect(() => validateBookingInput({ ...validBooking, type: "pickup", site: "", pickupLocation: "" })).toThrow("Pickup location is required");
  });

  it("requires a site for bundle requests", () => {
    expect(() => validateBookingInput({ ...validBooking, type: "misc", site: "", bundleRequested: true })).toThrow("job site is required");
  });

  it("rejects forged photo identifiers", () => {
    expect(() => validateBookingInput({ ...validBooking, photoId: "../../another-record" })).toThrow("Invalid photo ID");
  });
});

describe("site validation", () => {
  it("rejects partial and out-of-range coordinates", () => {
    expect(() => validateSiteInput({ name: "Site", min: 10, km: 5, lat: 48 })).toThrow("provided together");
    expect(() => validateSiteInput({ name: "Site", min: 10, km: 5, lat: 95, lng: -123 })).toThrow("Latitude");
  });

  it("requires a canonical address when coordinates are saved", () => {
    expect(() => validateSiteInput({ name: "Site", min: 10, km: 5, lat: 48.49, lng: -123.37 })).toThrow("Site address is required");
    expect(validateSiteInput({
      name: "Site",
      address: "4368 Lochside Drive, Saanich, British Columbia, Canada",
      min: 10,
      km: 5,
      lat: 48.4952,
      lng: -123.3698,
    })).toMatchObject({ address: "4368 Lochside Drive, Saanich, British Columbia, Canada" });
  });
});
