import type { Config, Context } from "@netlify/functions";
import { requireUser, canDispatch, requireSameOrigin } from "./_shared/auth";
import { recordAudit } from "./_shared/audit";
import { estimateDispatch } from "./_shared/cost";
import { allowMethods, handleError, HttpError, json, readJson } from "./_shared/http";
import { once } from "./_shared/idempotency";
import { enforceRateLimit } from "./_shared/rate-limit";
import { bindPhotoToBooking, createBookingRecord, deleteBookingRecord, getBooking, getBookingVersioned, listBookings, listSites, photosStore, saveBooking, saveBookingIfMatch, unbindPhoto } from "./_shared/stores";
import { notifyNewBooking, notifyStatus } from "./_shared/slack";
import type { Booking } from "./_shared/types";
import { idempotencyKey, isBookingId, validateBookingInput, validateStatus, validateVersion } from "./_shared/validation";
import { canTransition } from "./_shared/workflow";

async function assertPhotoOwner(photoId: string | null, userId: string) {
  if (!photoId) return;
  const result = await photosStore().getMetadata(`photo/${photoId}`);
  const metadata = result?.metadata as { uploadedBy?: string } | undefined;
  if (!metadata || metadata.uploadedBy !== userId) throw new HttpError(422, "Photo was not uploaded by this account");
}

function publicBooking(booking: Booking, user: { id: string; roles: string[] }) {
  const full = user.roles.includes("dispatcher") || user.roles.includes("manager");
  const photo = booking.photoId ? `/api/photos/${encodeURIComponent(booking.photoId)}` : null;
  const owner = booking.requesterId === user.id;
  const canEdit = full || (owner && booking.status === "pending");
  if (full) return { ...booking, photo, canEdit };
  const { requesterId: _requesterId, requesterEmail: _requesterEmail, brentNotes: _brentNotes, estCost: _estCost, estMinutes: _estMinutes, estKm: _estKm, ...safe } = booking;
  if (owner) return { ...safe, photo, canEdit };
  const { notes: _notes, photoId: _photoId, ...teamSafe } = safe;
  return { ...teamSafe, photo: null, canEdit };
}

async function matchBundles(newBooking: Booking, all: Booking[]) {
  if (newBooking.bundleRequested) {
    const match = all
      .filter((item) => item.site === newBooking.site && !item.bundleRequested && !["declined", "completed"].includes(item.status) && item.date >= newBooking.date)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
    if (match) {
      newBooking.bundleStatus = "matched";
      newBooking.bundleWithId = match.id;
    }
  } else if (newBooking.site) {
    const waiting = all.filter((item) => item.site === newBooking.site && item.bundleStatus === "queued" && item.date <= newBooking.date);
    await Promise.all(waiting.map(async (item) => {
      item.bundleStatus = "matched";
      item.bundleWithId = newBooking.id;
      item.updatedAt = new Date().toISOString();
      item.version += 1;
      await saveBooking(item);
    }));
  }
}

async function createBooking(req: Request, context: Context) {
  const user = await requireUser();
  await enforceRateLimit(`${user.id}:${context.ip}`, "booking-create", 20);
  const key = idempotencyKey(req);
  const input = validateBookingInput(await readJson(req));
  const result = await once(`booking/${user.id}`, key, async () => {
    const all = await listBookings();
    const sites = await listSites();
    await assertPhotoOwner(input.photoId, user.id);
    const site = sites.find((item) => item.name.toLowerCase() === input.site.toLowerCase());
    const now = new Date().toISOString();
    const booking: Booking = {
      id: crypto.randomUUID(),
      version: 1,
      status: "pending",
      requester: user.name,
      requesterEmail: user.email,
      requesterId: user.id,
      brentNotes: "",
      bundleStatus: input.bundleRequested ? "queued" : "none",
      bundleWithId: null,
      createdAt: now,
      updatedAt: now,
      ...input,
      ...estimateDispatch(input.type, site),
    };
    await matchBundles(booking, all);
    const created = await createBookingRecord(booking);
    if (!created.modified) throw new HttpError(409, "Booking ID collision. Please retry.");
    if (booking.photoId) await bindPhotoToBooking(booking.photoId, booking.id);
    context.waitUntil(notifyNewBooking(booking));
    context.waitUntil(recordAudit(user, "booking.created", "booking", booking.id, context, { status: booking.status, site: booking.site }));
    return { status: 201, value: booking };
  });
  return json(publicBooking(result.value, user), result.status, { "Idempotency-Replayed": String(result.replayed) });
}

async function updateBooking(req: Request, context: Context, id: string) {
  const user = await requireUser();
  await enforceRateLimit(`${user.id}:${context.ip}`, "booking-update", 40);
  const key = idempotencyKey(req);
  const result = await once(`booking-update/${user.id}/${id}`, key, async () => {
    const record = await getBookingVersioned(id);
    if (!record) throw new HttpError(404, "Booking not found");
    const current = record.booking;
    const body = await readJson(req) as Record<string, unknown>;
    const version = validateVersion(body.version);
    if (current.version !== version) throw new HttpError(409, "This booking changed on another device. Refresh and try again.");

    const dispatcher = canDispatch(user);
    if (!dispatcher && (current.requesterId !== user.id || current.status !== "pending")) {
      throw new HttpError(403, "You can only edit your own pending bookings");
    }

    let updated: Booking;
    if (body.status !== undefined) {
      if (!dispatcher) throw new HttpError(403, "Dispatcher access required");
      const status = validateStatus(body.status);
      if (!canTransition(current.status, status)) throw new HttpError(409, `Cannot change ${current.status} to ${status}`);
      updated = {
        ...current,
        status,
        brentNotes: typeof body.brentNotes === "string" ? body.brentNotes.trim().slice(0, 2000) : current.brentNotes,
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
      if (status === "approved") updated.approvedAt = updated.updatedAt;
      if (status === "completed") updated.completedAt = updated.updatedAt;
    } else {
      const input = validateBookingInput(body);
      const sites = await listSites();
      if (input.photoId !== current.photoId) await assertPhotoOwner(input.photoId, user.id);
      const site = sites.find((item) => item.name.toLowerCase() === input.site.toLowerCase());
      updated = {
        ...current,
        ...input,
        ...estimateDispatch(input.type, site),
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
      };
    }
    const write = await saveBookingIfMatch(updated, record.etag);
    if (!write.modified) throw new HttpError(409, "This booking changed on another device. Refresh and try again.");
    if (updated.photoId && updated.photoId !== current.photoId) await bindPhotoToBooking(updated.photoId, updated.id);
    if (current.photoId && current.photoId !== updated.photoId) {
      context.waitUntil(Promise.all([photosStore().delete(`photo/${current.photoId}`), unbindPhoto(current.photoId)]).then(() => undefined));
    }
    if (body.status !== undefined) context.waitUntil(notifyStatus(updated));
    context.waitUntil(recordAudit(user, body.status !== undefined ? "booking.status_changed" : "booking.updated", "booking", id, context, {
      fromStatus: current.status,
      toStatus: updated.status,
      version: updated.version,
    }));
    return { status: 200, value: updated };
  });
  return json(publicBooking(result.value, user), result.status, { "Idempotency-Replayed": String(result.replayed) });
}

async function removeBooking(req: Request, context: Context, id: string) {
  const user = await requireUser(["dispatcher", "manager"]);
  await enforceRateLimit(`${user.id}:${context.ip}`, "booking-delete", 20);
  const key = idempotencyKey(req);
  const result = await once(`booking-delete/${user.id}/${id}`, key, async () => {
    const current = await getBooking(id);
    if (!current) throw new HttpError(404, "Booking not found");
    await deleteBookingRecord(id);
    if (current.photoId) await Promise.all([photosStore().delete(`photo/${current.photoId}`), unbindPhoto(current.photoId)]);
    context.waitUntil(recordAudit(user, "booking.deleted", "booking", id, context, { status: current.status, site: current.site }));
    return { status: 200, value: { deleted: true } };
  });
  return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
}

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["GET", "POST", "PUT", "DELETE"]);
    if (req.method !== "GET") requireSameOrigin(req);
    const id = context.params.id;
    if (req.method === "GET") {
      const user = await requireUser();
      const bookings = await listBookings();
      bookings.sort((a, b) => `${b.createdAt}`.localeCompare(`${a.createdAt}`));
      return json(bookings.map((booking) => publicBooking(booking, user)));
    }
    if (req.method === "POST" && !id) return await createBooking(req, context);
    if (!id || !isBookingId(id)) throw new HttpError(400, "Valid booking ID required");
    if (req.method === "PUT") return await updateBooking(req, context, id);
    if (req.method === "DELETE") return await removeBooking(req, context, id);
    throw new HttpError(405, "Method not allowed");
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = {
  path: ["/api/bookings", "/api/bookings/:id"],
};
