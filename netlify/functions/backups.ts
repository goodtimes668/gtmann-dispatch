import type { Config, Context } from "@netlify/functions";
import { recordAudit } from "./_shared/audit";
import { requireSameOrigin, requireUser } from "./_shared/auth";
import { createBackup, restoreBackup } from "./_shared/backup";
import { allowMethods, handleError, HttpError, json, readJson } from "./_shared/http";
import { once } from "./_shared/idempotency";
import { enforceRateLimit } from "./_shared/rate-limit";
import { getBackupSnapshot, listBackupSnapshots } from "./_shared/stores";
import { idempotencyKey } from "./_shared/validation";

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["GET", "POST", "PUT"]);
    const user = await requireUser(["manager"]);
    const id = context.params.id;
    if (id && (!/^[a-zA-Z0-9-]+$/.test(id) || id.length > 100)) throw new HttpError(400, "Invalid backup ID");

    if (req.method === "GET") {
      if (!id) return json(await listBackupSnapshots());
      const snapshot = await getBackupSnapshot(id);
      if (!snapshot) throw new HttpError(404, "Backup not found");
      return json(snapshot, 200, { "Content-Disposition": `attachment; filename="gtmann-dispatch-${id}.json"` });
    }

    requireSameOrigin(req);
    await enforceRateLimit(`${user.id}:${context.ip}`, "backup-admin", 5, 60 * 60 * 1000);
    if (req.method === "POST" && !id) {
      const result = await once(`backup-create/${user.id}`, idempotencyKey(req), async () => {
        const snapshot = await createBackup("manager");
        return { status: 201, value: snapshot };
      });
      if (!result.replayed) context.waitUntil(recordAudit(user, "backup.created", "backup", result.value.id, context, {
        bookings: result.value.bookings.length,
        sites: result.value.sites.length,
        photos: result.value.photoIds.length,
      }));
      return json({ id: result.value.id, createdAt: result.value.createdAt }, result.status, { "Idempotency-Replayed": String(result.replayed) });
    }

    if (req.method === "PUT" && id) {
      const body = await readJson(req, 16 * 1024) as Record<string, unknown>;
      if (body.confirmation !== "RESTORE") throw new HttpError(422, "Type RESTORE to confirm recovery");
      const result = await once(`backup-restore/${user.id}/${id}`, idempotencyKey(req), async () => {
        try { return { status: 200, value: await restoreBackup(id) }; }
        catch { throw new HttpError(404, "Backup not found or unsupported"); }
      });
      if (!result.replayed) context.waitUntil(recordAudit(user, "backup.restored", "backup", id, context, {
        bookings: result.value.bookings.length,
        sites: result.value.sites.length,
        photos: result.value.photoIds.length,
      }));
      return json({ restored: true, id }, 200, { "Idempotency-Replayed": String(result.replayed) });
    }
    throw new HttpError(405, "Method not allowed");
  } catch (error) {
    return handleError(error, context.requestId);
  }
};

export const config: Config = { path: ["/api/admin/backups", "/api/admin/backups/:id"] };
