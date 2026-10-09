import { getStore } from "@netlify/blobs";

// A short rolling record of what happened to each Slack request, so a broken
// setup (wrong secret, wrong bot token, missing scope) can be read back without
// opening the function log. It never stores secrets, signatures or form text.
const store = () => getStore({ name: "dispatch-slack-diagnostics", consistency: "strong" });
const KEEP = 60;

export type SlackTrace = { at: string; event: string } & Record<string, string | number | boolean | null | undefined>;

export async function recordSlackTrace(event: string, details: Record<string, string | number | boolean | null | undefined> = {}) {
  try {
    const at = new Date().toISOString();
    const reverseTime = String(9_999_999_999_999 - Date.parse(at)).padStart(13, "0");
    const diagnostics = store();
    await diagnostics.setJSON(`trace/${reverseTime}-${crypto.randomUUID()}`, { at, event, ...details });
    const { blobs } = await diagnostics.list({ prefix: "trace/" });
    // Keys sort newest first, so everything past KEEP is the oldest.
    await Promise.all(blobs.map(({ key }) => key).sort().slice(KEEP).map((key) => diagnostics.delete(key)));
  } catch (error) {
    // Diagnostics must never break the request they describe.
    console.error("Slack diagnostics write failed", error instanceof Error ? error.message : String(error));
  }
}

export async function recentSlackTraces(limit = 30): Promise<SlackTrace[]> {
  const diagnostics = store();
  const { blobs } = await diagnostics.list({ prefix: "trace/" });
  const keys = blobs.map(({ key }) => key).sort().slice(0, limit);
  const records = await Promise.all(keys.map((key) => diagnostics.get(key, { type: "json" }) as Promise<SlackTrace | null>));
  return records.filter((record): record is SlackTrace => Boolean(record));
}
