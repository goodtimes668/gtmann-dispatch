import { admin } from "@netlify/identity";
import type { Config, Context } from "@netlify/functions";
import { requireSameOrigin, requireUser } from "./_shared/auth";
import { recordAudit } from "./_shared/audit";
import { handleError, HttpError, json, readJson } from "./_shared/http";
import { once } from "./_shared/idempotency";
import { enforceRateLimit } from "./_shared/rate-limit";
import { idempotencyKey } from "./_shared/validation";

const assignableRoles = new Set(["member", "dispatcher", "manager"]);
const knownRoles = new Set(["pending", ...assignableRoles]);

function safeUser(user: { id: string; email?: string; name?: string; roles?: string[]; role?: string }) {
  const role = user.roles?.includes("manager") ? "manager"
    : user.roles?.includes("dispatcher") ? "dispatcher"
      : user.roles?.includes("pending") ? "pending"
        : knownRoles.has(user.role || "") ? user.role : "member";
  return { id: user.id, email: user.email || "", name: user.name || user.email || "Team member", role };
}

export default async (req: Request, context: Context) => {
  try {
    const caller = await requireUser(["manager"]);
    await enforceRateLimit(`${caller.id}:${context.ip}`, "user-admin", 30);
    const id = context.params.id;

    if (req.method === "GET" && !id) {
      const users = await admin.listUsers({ page: 1, perPage: 100 });
      return json(users.map(safeUser).sort((a, b) => a.email.localeCompare(b.email)));
    }
    if (req.method !== "PUT" || !id) throw new HttpError(405, "Method not allowed");
    requireSameOrigin(req);
    const key = idempotencyKey(req);
    const result = await once(`user-role/${caller.id}/${id}`, key, async () => {
      const body = await readJson(req) as Record<string, unknown>;
      if (typeof body.role !== "string" || !assignableRoles.has(body.role)) throw new HttpError(422, "Invalid role");
      if (id === caller.id && body.role !== "manager") throw new HttpError(409, "You cannot remove your own manager access");
      const updated = await admin.updateUser(id, { role: body.role });
      context.waitUntil(recordAudit(caller, "user.role_changed", "user", id, context, { role: body.role }));
      return { status: 200, value: safeUser(updated) };
    });
    return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: ["/api/admin/users", "/api/admin/users/:id"] };
