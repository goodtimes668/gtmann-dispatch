import type { Config, Context } from "@netlify/functions";
import { canDispatch, requireSameOrigin, requireUser } from "./_shared/auth";
import { recordAudit } from "./_shared/audit";
import { handleError, HttpError, json } from "./_shared/http";
import { once } from "./_shared/idempotency";
import { enforceRateLimit } from "./_shared/rate-limit";
import { findBookingByPhotoId, photosStore } from "./_shared/stores";
import { idempotencyKey, isUuid } from "./_shared/validation";

const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxBytes = 5 * 1024 * 1024;

export default async (req: Request, context: Context) => {
  try {
    const user = await requireUser();
    const id = context.params.id;
    const store = photosStore();

    if (req.method === "GET") {
      if (!id || !isUuid(id)) throw new HttpError(400, "Valid photo ID required");
      const booking = await findBookingByPhotoId(id);
      if (!booking) throw new HttpError(404, "Photo not found");
      if (!canDispatch(user) && booking.requesterId !== user.id) throw new HttpError(403, "You do not have access to this photo");
      const result = await store.getWithMetadata(`photo/${id}`, { type: "arrayBuffer" });
      if (!result) throw new HttpError(404, "Photo not found");
      const metadata = result.metadata as { contentType?: string } | undefined;
      return new Response(result.data as ArrayBuffer, {
        headers: {
          "Cache-Control": "private, max-age=3600",
          "Content-Type": metadata?.contentType || "application/octet-stream",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (req.method !== "POST" || id) throw new HttpError(405, "Method not allowed");
    requireSameOrigin(req);
    await enforceRateLimit(`${user.id}:${context.ip}`, "photo-upload", 30, 60 * 60 * 1000);
    const key = idempotencyKey(req);
    const contentType = req.headers.get("content-type") || "";
    if (!contentType.includes("multipart/form-data")) throw new HttpError(415, "Expected multipart form data");
    const declared = Number(req.headers.get("content-length") || 0);
    if (declared > 6 * 1024 * 1024) throw new HttpError(413, "Photo upload is too large");
    let form: FormData;
    try { form = await req.formData(); } catch { throw new HttpError(400, "Invalid photo upload"); }
    const file = form.get("photo");
    if (!(file instanceof File)) throw new HttpError(422, "Photo file is required");
    if (!allowedTypes.has(file.type)) throw new HttpError(422, "Photo must be JPEG, PNG, or WebP");
    if (file.size < 1 || file.size > maxBytes) throw new HttpError(422, "Photo must be smaller than 5MB");

    const result = await once(`photo/${user.id}`, key, async () => {
      const photoId = crypto.randomUUID();
      await store.set(`photo/${photoId}`, await file.arrayBuffer(), {
        metadata: {
          contentType: file.type,
          fileName: file.name.slice(0, 180),
          size: file.size,
          uploadedBy: user.id,
          uploadedAt: new Date().toISOString(),
        },
      });
      context.waitUntil(recordAudit(user, "photo.uploaded", "photo", photoId, context, { size: file.size, contentType: file.type }));
      return { status: 201, value: { id: photoId, url: `/api/photos/${photoId}` } };
    });
    return json(result.value, result.status, { "Idempotency-Replayed": String(result.replayed) });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = {
  path: ["/api/photos", "/api/photos/:id"],
};
