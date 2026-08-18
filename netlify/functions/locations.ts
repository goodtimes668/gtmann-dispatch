import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { allowMethods, handleError, HttpError, json } from "./_shared/http";
import { normalizePhotonFeature } from "./_shared/locations";
import { enforceRateLimit } from "./_shared/rate-limit";
import { FAITHWOOD_ORIGIN } from "./_shared/route";

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["GET"]);
    const user = await requireUser(["dispatcher", "manager"]);
    await enforceRateLimit(`${user.id}:${context.ip}`, "location-search", 50);

    const query = new URL(req.url).searchParams.get("q")?.trim() || "";
    if (query.length < 3) return json({ suggestions: [], attribution: "© OpenStreetMap contributors" });
    if (query.length > 160) throw new HttpError(422, "Address search is too long");

    const url = new URL("https://photon.komoot.io/api/");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "6");
    url.searchParams.set("lang", "en");
    url.searchParams.set("lat", String(FAITHWOOD_ORIGIN.lat));
    url.searchParams.set("lon", String(FAITHWOOD_ORIGIN.lng));
    url.searchParams.set("bbox", "-130,48,-114,60");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6_000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "GT-Mann-Dispatch/1.0 (https://gtmann-dispatch.netlify.app)",
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw new HttpError(502, "Address lookup is temporarily unavailable");
    const payload = await response.json() as { features?: unknown[] };
    const suggestions = (Array.isArray(payload.features) ? payload.features : [])
      .map((feature, index) => normalizePhotonFeature(feature as never, index))
      .filter((suggestion) => suggestion !== null);
    return json({ suggestions, attribution: "© OpenStreetMap contributors" });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/locations" };
