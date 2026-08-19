import { describe, expect, it } from "vitest";
import { approximateRoundTrip, FAITHWOOD_ORIGIN, straightLineKm } from "../netlify/functions/_shared/route";

describe("Faithwood route calculations", () => {
  it("uses the supplied Faithwood Farms coordinates as the origin", () => {
    expect(FAITHWOOD_ORIGIN).toMatchObject({
      address: "4368 Lochside Drive, Saanich, BC",
      lat: 48.4952,
      lng: -123.3698,
    });
    expect(straightLineKm(48.4952, -123.3698, 48.4952, -123.3698)).toBe(0);
  });

  it("returns a labelled round-trip fallback when live routing is unavailable", () => {
    const route = approximateRoundTrip(48.4284, -123.3656);
    expect(route.source).toBe("estimated");
    expect(route.roundTripKm).toBeGreaterThan(10);
    expect(route.roundTripMinutes).toBeGreaterThan(10);
  });
});
