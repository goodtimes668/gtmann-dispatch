import { describe, expect, it } from "vitest";
import { actualDispatchCost, estimateDispatch } from "../netlify/functions/_shared/cost";

describe("dispatch cost model", () => {
  it("calculates a material delivery from the saved round trip", () => {
    expect(estimateDispatch("delivery", { name: "Test", min: 20, km: 14, version: 1, createdAt: "", updatedAt: "" })).toEqual({
      estCost: 33.13,
      estMinutes: 35,
      estKm: 14,
    });
  });

  it("adds the pickup leg for tool deliveries", () => {
    expect(estimateDispatch("tool-delivery", { name: "Test", min: 20, km: 14, version: 1, createdAt: "", updatedAt: "" })).toEqual({
      estCost: 51.43,
      estMinutes: 53,
      estKm: 23,
    });
  });

  it("uses the documented default for an unknown site", () => {
    expect(estimateDispatch("misc")).toEqual({ estCost: 41.2, estMinutes: 45, estKm: 16 });
  });

  it("calculates actual cost from recorded time and kilometres", () => {
    expect(actualDispatchCost(60, 20)).toBe(54);
  });
});
