import { HttpError } from "./http";
import { rateLimitStore } from "./stores";

export async function enforceRateLimit(subject: string, action: string, limit = 30, windowMs = 60_000) {
  const store = rateLimitStore();
  const windowId = Math.floor(Date.now() / windowMs);
  const safeSubject = encodeURIComponent(subject.slice(0, 120));
  const prefix = `${action}/${safeSubject}/`;
  const key = `${prefix}${windowId}`;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = await store.getWithMetadata(key, { type: "json" });
    const current = existing?.data as { count?: number } | undefined;
    const count = (current?.count || 0) + 1;
    const write = await store.setJSON(
      key,
      { count, expiresAt: (windowId + 1) * windowMs },
      existing?.etag ? { onlyIfMatch: existing.etag } : { onlyIfNew: true }
    );
    if (!write.modified) continue;

    if (count === 1) {
      const { blobs } = await store.list({ prefix });
      await Promise.all(blobs
        .filter(({ key: candidate }) => Number(candidate.slice(prefix.length)) < windowId - 1)
        .map(({ key: candidate }) => store.delete(candidate)));
    }
    if (count > limit) throw new HttpError(429, "Too many requests. Please try again shortly.");
    return;
  }
  throw new HttpError(429, "Too many concurrent requests. Please try again shortly.");
}
