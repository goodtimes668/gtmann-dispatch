export const FAITHWOOD_ORIGIN = {
  name: "Faithwood Farms",
  address: "4368 Lochside Drive, Saanich, BC",
  lat: 48.4952,
  lng: -123.3698,
};

export type RouteSource = "mapbox" | "estimated";

export type RoundTripRoute = {
  roundTripMinutes: number;
  roundTripKm: number;
  source: RouteSource;
};

const EARTH_RADIUS_KM = 6371.0088;
const ESTIMATED_ROAD_FACTOR = 1.28;
const ESTIMATED_AVERAGE_KPH = 40;

function radians(degrees: number) {
  return degrees * Math.PI / 180;
}

export function straightLineKm(fromLat: number, fromLng: number, toLat: number, toLng: number) {
  const latDelta = radians(toLat - fromLat);
  const lngDelta = radians(toLng - fromLng);
  const a = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(fromLat)) * Math.cos(radians(toLat)) * Math.sin(lngDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

export function approximateRoundTrip(destinationLat: number, destinationLng: number): RoundTripRoute {
  const oneWayRoadKm = straightLineKm(
    FAITHWOOD_ORIGIN.lat,
    FAITHWOOD_ORIGIN.lng,
    destinationLat,
    destinationLng,
  ) * ESTIMATED_ROAD_FACTOR;
  const roundTripKm = oneWayRoadKm * 2;
  const roundTripMinutes = (roundTripKm / ESTIMATED_AVERAGE_KPH) * 60;
  return {
    roundTripMinutes: Math.max(1, Math.round(roundTripMinutes)),
    roundTripKm: Math.round(roundTripKm * 10) / 10,
    source: "estimated",
  };
}

async function mapboxRoundTrip(destinationLat: number, destinationLng: number, token: string): Promise<RoundTripRoute | null> {
  const coordinates = `${FAITHWOOD_ORIGIN.lng},${FAITHWOOD_ORIGIN.lat};${destinationLng},${destinationLat}`;
  const url = new URL(`https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}`);
  url.searchParams.set("alternatives", "false");
  url.searchParams.set("overview", "false");
  url.searchParams.set("steps", "false");
  url.searchParams.set("access_token", token);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json() as { routes?: Array<{ distance?: number; duration?: number }> };
    const route = data.routes?.[0];
    if (!route || !Number.isFinite(route.distance) || !Number.isFinite(route.duration)) return null;
    return {
      roundTripMinutes: Math.max(1, Math.round((route.duration! * 2) / 60)),
      roundTripKm: Math.round((route.distance! * 2) / 100) / 10,
      source: "mapbox",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function routeFromFaithwood(destinationLat: number, destinationLng: number) {
  const token = (Netlify.env.get("MAPBOX_ACCESS_TOKEN") || "").trim();
  if (token) {
    const live = await mapboxRoundTrip(destinationLat, destinationLng, token);
    if (live) return live;
  }
  return approximateRoundTrip(destinationLat, destinationLng);
}
