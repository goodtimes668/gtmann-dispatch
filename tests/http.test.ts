import { afterEach, describe, expect, it, vi } from "vitest";
import { handleError, HttpError } from "../netlify/functions/_shared/http";

describe("function error handling", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns validation errors without exposing internals", async () => {
    const response = handleError(new HttpError(422, "Bad input"), "request-1");
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Bad input" });
  });

  it("assigns a traceable request id to unexpected failures", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = handleError(new Error("database unavailable"), "request-2");
    expect(response.status).toBe(500);
    expect(response.headers.get("X-Request-ID")).toBe("request-2");
    expect(await response.json()).toEqual({ error: "Internal server error", requestId: "request-2" });
    expect(errorLog).toHaveBeenCalledOnce();
    expect(String(errorLog.mock.calls[0][0])).toContain('"requestId":"request-2"');
  });
});
