import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { allowMethods, handleError, HttpError, json } from "./_shared/http";
import { enforceRateLimit } from "./_shared/rate-limit";
import { FAITHWOOD_ORIGIN, routeFromFaithwood } from "./_shared/route";

function coordinate(value: string | null, name: string, min: number, max: number) {
  const parsed = Number(value);
  if (!value || !Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new HttpError(422, `${name} must be between ${min} and ${max}`);
  }
  return parsed;
}

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["GET"]);
    const user = await requireUser(["dispatcher", "manager"]);
    await enforceRateLimit(`${user.id}:${context.ip}`, "route-preview", 30);
    const params = new URL(req.url).searchParams;
    const lat = coordinate(params.get("lat"), "Latitude", -90, 90);
    const lng = coordinate(params.get("lng"), "Longitude", -180, 180);
    const route = await routeFromFaithwood(lat, lng);
    return json({
      origin: FAITHWOOD_ORIGIN,
      ...route,
      notice: route.source === "mapbox"
        ? "Live road route"
        : "Approximate road estimate; configure MAPBOX_ACCESS_TOKEN for live routing",
    });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/route" };
