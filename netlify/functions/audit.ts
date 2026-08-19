import type { Config, Context } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { allowMethods, handleError, HttpError, json } from "./_shared/http";
import { listAuditEvents } from "./_shared/stores";

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["GET"]);
    await requireUser(["manager"]);
    const requested = Number(new URL(req.url).searchParams.get("limit") || 100);
    if (!Number.isInteger(requested) || requested < 1 || requested > 500) throw new HttpError(422, "Limit must be between 1 and 500");
    return json(await listAuditEvents(requested));
  } catch (error) {
    return handleError(error, context.requestId);
  }
};

export const config: Config = { path: "/api/admin/audit" };
