import type { BookingType, Site } from "./types";

export const COST_MODEL = {
  wagePerHour: 40,
  mileagePerKm: 0.70,
  overheadMinutes: 15,
  defaultRoute: { min: 30, km: 16 },
  pickupLeg: { min: 18, km: 9 },
};

export function dispatchBreakdown(type: BookingType, site?: Site) {
  const route = site || COST_MODEL.defaultRoute;
  const pickup = type === "pickup" || type === "tool-delivery";
  const minutes = route.min + COST_MODEL.overheadMinutes + (pickup ? COST_MODEL.pickupLeg.min : 0);
  const km = route.km + (pickup ? COST_MODEL.pickupLeg.km : 0);
  const labor = (minutes / 60) * COST_MODEL.wagePerHour;
  const mileage = km * COST_MODEL.mileagePerKm;
  return { minutes, km, labor, mileage, cost: labor + mileage };
}

export function estimateDispatch(type: BookingType, site?: Site) {
  const { minutes, km, cost } = dispatchBreakdown(type, site);
  return {
    estMinutes: Math.round(minutes),
    estKm: Math.round(km * 10) / 10,
    estCost: Math.round(cost * 100) / 100,
  };
}
