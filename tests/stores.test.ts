import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const setJSON = vi.fn(async (key: string, _value: unknown, options?: unknown) => {
  calls.push(`set:${key}:${JSON.stringify(options || {})}`);
  return { modified: true, etag: "new" };
});
const deleteBlob = vi.fn(async (key: string) => { calls.push(`delete:${key}`); });

vi.mock("@netlify/blobs", () => ({
  getStore: () => ({ setJSON, delete: deleteBlob }),
}));

import { deleteSiteIfMatch, saveSiteIfMatch } from "../netlify/functions/_shared/stores";

const site = {
  name: "New Site",
  min: 20,
  km: 12,
  version: 2,
  createdAt: "2026-08-18T00:00:00.000Z",
  updatedAt: "2026-08-18T01:00:00.000Z",
};

describe("crash-safe site writes", () => {
  beforeEach(() => { calls.length = 0; setJSON.mockClear(); deleteBlob.mockClear(); });

  it("uses the current etag for an in-place update", async () => {
    await saveSiteIfMatch(site, "New Site", "etag-1");
    expect(setJSON).toHaveBeenCalledWith("site/new%20site", site, { onlyIfMatch: "etag-1" });
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("writes the new name before deleting the old name", async () => {
    await saveSiteIfMatch(site, "Old Site", "etag-1");
    expect(calls[0]).toContain("set:site/new%20site");
    expect(calls[1]).toBe("delete:site/old%20site");
  });

  it("keeps the old site when the new name cannot be created", async () => {
    setJSON.mockResolvedValueOnce({ modified: false, etag: "existing" });
    const result = await saveSiteIfMatch(site, "Old Site", "etag-1");
    expect(result.modified).toBe(false);
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("conditionally tombstones a site before physical deletion", async () => {
    await deleteSiteIfMatch(site, "etag-2");
    expect(setJSON.mock.calls[0][2]).toEqual({ onlyIfMatch: "etag-2" });
    expect((setJSON.mock.calls[0][1] as { deletedAt?: string }).deletedAt).toBeTruthy();
    expect(calls[1]).toBe("delete:site/new%20site");
  });
});
