import { describe, expect, it } from "vitest";
import { normalizePhotonFeature } from "../netlify/functions/_shared/locations";

describe("address result normalization", () => {
  it("turns a Canadian Photon result into a canonical address", () => {
    expect(normalizePhotonFeature({
      geometry: { coordinates: [-123.3698, 48.4952] },
      properties: {
        osm_type: "W",
        osm_id: 123,
        name: "Faithwood Farms",
        housenumber: "4368",
        street: "Lochside Drive",
        city: "Saanich",
        state: "British Columbia",
        postcode: "V8X 2C8",
        country: "Canada",
        countrycode: "CA",
      },
    }, 0)).toMatchObject({
      label: "Faithwood Farms — 4368 Lochside Drive, Saanich, British Columbia, V8X 2C8, Canada",
      address: "4368 Lochside Drive, Saanich, British Columbia, V8X 2C8, Canada",
      lat: 48.4952,
      lng: -123.3698,
    });
  });

  it("drops non-Canadian and malformed results", () => {
    expect(normalizePhotonFeature({ geometry: { coordinates: [-123, 48] }, properties: { name: "Test", countrycode: "US" } }, 0)).toBeNull();
    expect(normalizePhotonFeature({ geometry: { coordinates: [] }, properties: { name: "Test", countrycode: "CA" } }, 0)).toBeNull();
  });
});
