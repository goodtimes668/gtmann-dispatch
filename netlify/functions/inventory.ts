import type { Config, Context } from "@netlify/functions";
import { canDispatch, requireSameOrigin, requireUser } from "./_shared/auth";
import { recordAudit } from "./_shared/audit";
import { allowMethods, handleError, HttpError, json, readJson } from "./_shared/http";
import { once } from "./_shared/idempotency";
import { enforceRateLimit } from "./_shared/rate-limit";
import { createInventoryRecord, deleteInventoryIfMatch, getInventoryItemVersioned, listInventory, saveInventoryIfMatch } from "./_shared/stores";
import type { AuthUser, InventoryItem } from "./_shared/types";
import { idempotencyKey, isUuid, validateInventoryInput, validateVersion } from "./_shared/validation";

function publicInventory(items: InventoryItem[], user: AuthUser) {
  const full = canDispatch(user);
  return items.filter((item) => {
    if (full) return item.status !== "retired";
    return item.status === "active" || (item.status === "pending" && item.submittedById === user.id);
  });
}

function readInventoryId(req: Request) {
  const encoded = new URL(req.url).pathname.split("/").pop() || "";
  if (!encoded || encoded === "inventory") return "";
  try { return decodeURIComponent(encoded); }
  catch { throw new HttpError(400, "Invalid inventory item ID"); }
}

async function createItem(req: Request, context: Context, user: AuthUser) {
  await enforceRateLimit(`${user.id}:${context.ip}`, "inventory-create", 20);
  const key = idempotencyKey(req);
  const result = await once(`inventory-create/${user.id}`, key, async () => {
    const input = validateInventoryInput(await readJson(req), { canApprove: canDispatch(user) });
    const now = new Date().toISOString();
    const item: InventoryItem = {
      id: crypto.randomUUID(),
      version: 1,
      submittedBy: user.name,
      submittedById: user.id,
      createdAt: now,
      updatedAt: now,
      ...input,
    };
    const created = await createInventoryRecord(item);
    if (!created.modified) throw new HttpError(409, "Inventory ID collision. Please retry.");
    context.waitUntil(recordAudit(user, "inventory.created", "inventory", item.id, context, { name: item.name, status: item.status, category: item.category }));
    return { status: 201, value: item };
  });
  return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
}

async function updateItem(req: Request, context: Context, user: AuthUser, id: string) {
  if (!canDispatch(user)) throw new HttpError(403, "Dispatcher or manager access required");
  await enforceRateLimit(`${user.id}:${context.ip}`, "inventory-update", 30);
  const key = idempotencyKey(req);
  const result = await once(`inventory-update/${user.id}/${id}`, key, async () => {
    const record = await getInventoryItemVersioned(id);
    if (!record || record.item.deletedAt) throw new HttpError(404, "Inventory item not found");
    const current = record.item;
    const body = await readJson(req) as Record<string, unknown>;
    if (validateVersion(body.version) !== current.version) throw new HttpError(409, "This inventory item changed on another device. Refresh and try again.");
    const input = validateInventoryInput(body, { canApprove: true });
    const item: InventoryItem = { ...current, ...input, version: current.version + 1, updatedAt: new Date().toISOString() };
    const write = await saveInventoryIfMatch(item, record.etag);
    if (!write.modified) throw new HttpError(409, "This inventory item changed on another device. Refresh and try again.");
    context.waitUntil(recordAudit(user, "inventory.updated", "inventory", item.id, context, { name: item.name, status: item.status, version: item.version }));
    return { status: 200, value: item };
  });
  return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
}

async function deleteItem(req: Request, context: Context, user: AuthUser, id: string) {
  if (!canDispatch(user)) throw new HttpError(403, "Dispatcher or manager access required");
  await enforceRateLimit(`${user.id}:${context.ip}`, "inventory-delete", 20);
  const key = idempotencyKey(req);
  const result = await once(`inventory-delete/${user.id}/${id}`, key, async () => {
    const record = await getInventoryItemVersioned(id);
    if (!record || record.item.deletedAt) throw new HttpError(404, "Inventory item not found");
    const supplied = validateVersion(Number(new URL(req.url).searchParams.get("version")));
    if (supplied !== record.item.version) throw new HttpError(409, "This inventory item changed on another device. Refresh and try again.");
    const write = await deleteInventoryIfMatch(record.item, record.etag);
    if (!write.modified) throw new HttpError(409, "This inventory item changed on another device. Refresh and try again.");
    context.waitUntil(recordAudit(user, "inventory.deleted", "inventory", id, context, { name: record.item.name, version: record.item.version }));
    return { status: 200, value: { deleted: true } };
  });
  return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
}

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["GET", "POST", "PUT", "DELETE"]);
    if (req.method !== "GET") requireSameOrigin(req);
    const user = await requireUser();
    const id = readInventoryId(req);

    if (req.method === "GET") {
      const items = publicInventory(await listInventory(), user);
      if (!id) return json(items);
      if (!isUuid(id)) throw new HttpError(400, "Valid inventory item ID required");
      const item = items.find((candidate) => candidate.id === id);
      if (!item) throw new HttpError(404, "Inventory item not found");
      return json(item);
    }

    if (req.method === "POST" && !id) return await createItem(req, context, user);
    if (!id || !isUuid(id)) throw new HttpError(400, "Valid inventory item ID required");
    if (req.method === "PUT") return await updateItem(req, context, user, id);
    if (req.method === "DELETE") return await deleteItem(req, context, user, id);
    throw new HttpError(405, "Method not allowed");
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = {
  path: ["/api/inventory", "/api/inventory/:id"],
};