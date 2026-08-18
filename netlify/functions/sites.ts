import type { Config, Context } from "@netlify/functions";
import { requireSameOrigin, requireUser } from "./_shared/auth";
import { allowMethods, handleError, HttpError, json, readJson } from "./_shared/http";
import { once } from "./_shared/idempotency";
import { enforceRateLimit } from "./_shared/rate-limit";
import { routeFromFaithwood } from "./_shared/route";
import { deleteSiteRecord, listSites, saveSite } from "./_shared/stores";
import { idempotencyKey, validateSiteInput, validateVersion } from "./_shared/validation";

async function calculateRoute(input: ReturnType<typeof validateSiteInput>) {
  if (typeof input.lat !== "number" || typeof input.lng !== "number") return { ...input, routeSource: "manual" as const };
  const route = await routeFromFaithwood(input.lat, input.lng);
  return { ...input, min: route.roundTripMinutes, km: route.roundTripKm, routeSource: route.source };
}

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["GET", "POST", "PUT", "DELETE"]);
    if (req.method !== "GET") requireSameOrigin(req);
    if (req.method === "GET") {
      await requireUser();
      return json(await listSites());
    }

    const user = await requireUser(["dispatcher", "manager"]);
    await enforceRateLimit(`${user.id}:${context.ip}`, "site-mutation", 30);
    const key = idempotencyKey(req);
    let name = "";
    const encodedName = new URL(req.url).pathname.split("/").pop() || "";
    try { name = encodedName && encodedName !== "sites" ? decodeURIComponent(encodedName) : ""; }
    catch { throw new HttpError(400, "Invalid site name"); }
    if (name.length > 120) throw new HttpError(400, "Invalid site name");

    if (req.method === "POST") {
      const result = await once(`site-create/${user.id}`, key, async () => {
        const sites = await listSites();
        const input = await calculateRoute(validateSiteInput(await readJson(req)));
        if (sites.some((site) => site.name.toLowerCase() === input.name.toLowerCase())) throw new HttpError(409, "That site already exists");
        const now = new Date().toISOString();
        const site = { ...input, version: 1, createdAt: now, updatedAt: now };
        await saveSite(site);
        return { status: 201, value: site };
      });
      return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
    }

    if (!name) throw new HttpError(400, "Site name required");

    if (req.method === "PUT") {
      const result = await once(`site-update/${user.id}/${encodeURIComponent(name)}`, key, async () => {
        const sites = await listSites();
        const current = sites.find((site) => site.name.toLowerCase() === name.toLowerCase());
        if (!current) throw new HttpError(404, "Site not found");
        const body = await readJson(req) as Record<string, unknown>;
        if (validateVersion(body.version) !== current.version) throw new HttpError(409, "This site changed on another device. Refresh and try again.");
        const input = await calculateRoute(validateSiteInput(body));
        if (sites.some((site) => site.name.toLowerCase() === input.name.toLowerCase() && site.name.toLowerCase() !== current.name.toLowerCase())) {
          throw new HttpError(409, "That site already exists");
        }
        const site = { ...current, ...input, version: current.version + 1, updatedAt: new Date().toISOString() };
        await saveSite(site, current.name);
        return { status: 200, value: site };
      });
      return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
    }

    const result = await once(`site-delete/${user.id}/${encodeURIComponent(name)}`, key, async () => {
      const sites = await listSites();
      const current = sites.find((site) => site.name.toLowerCase() === name.toLowerCase());
      if (!current) throw new HttpError(404, "Site not found");
      const supplied = validateVersion(Number(new URL(req.url).searchParams.get("version")));
      if (supplied !== current.version) throw new HttpError(409, "This site changed on another device. Refresh and try again.");
      await deleteSiteRecord(current.name);
      return { status: 200, value: { deleted: true } };
    });
    return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = {
  path: ["/api/sites", "/api/sites/:name"],
};
