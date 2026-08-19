import { HttpError } from "./http";
import { idempotencyStore } from "./stores";

type Completed<T> = { state: "done"; status: number; value: T; createdAt: string };
type Pending = { state: "pending"; owner: string; createdAt: string };
type Cached<T> = Completed<T> | Pending;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function once<T>(scope: string, key: string, run: () => Promise<{ status: number; value: T }>) {
  const store = idempotencyStore();
  const cacheKey = `${scope}/${encodeURIComponent(key)}`;
  const owner = crypto.randomUUID();

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const existing = await store.getWithMetadata(cacheKey, { type: "json" });
    const cached = existing?.data as Cached<T> | (Omit<Completed<T>, "state">) | undefined;
    if (cached && (!("state" in cached) || cached.state === "done")) {
      return { status: cached.status, value: cached.value, replayed: true };
    }

    const reservation: Pending = { state: "pending", owner, createdAt: new Date().toISOString() };
    const stale = cached?.state === "pending" && Date.now() - Date.parse(cached.createdAt) > 30_000;
    const write = await store.setJSON(
      cacheKey,
      reservation,
      existing?.etag ? (stale ? { onlyIfMatch: existing.etag } : { onlyIfNew: true }) : { onlyIfNew: true }
    );
    if (!write.modified) {
      await pause(100);
      continue;
    }

    try {
      const result = await run();
      const completed: Completed<T> = { state: "done", ...result, createdAt: new Date().toISOString() };
      const saved = await store.setJSON(cacheKey, completed, write.etag ? { onlyIfMatch: write.etag } : {});
      if (!saved.modified) throw new HttpError(503, "Action result could not be finalized. Please retry.");
      return { ...result, replayed: false };
    } catch (error) {
      const lock = await store.getWithMetadata(cacheKey, { type: "json" });
      const pending = lock?.data as Pending | undefined;
      if (pending?.state === "pending" && pending.owner === owner) await store.delete(cacheKey);
      throw error;
    }
  }
  throw new HttpError(503, "The same action is still processing. Please retry shortly.");
}
