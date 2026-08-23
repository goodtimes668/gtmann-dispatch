import { afterEach, describe, expect, it } from "vitest";
import { handler } from "../netlify/functions/identity-signup.mts";

function setNetlifyEnv(bootstrapEmail = "") {
  Object.defineProperty(globalThis, "Netlify", {
    configurable: true,
    value: { env: { get: (name: string) => name === "BOOTSTRAP_MANAGER_EMAIL" ? bootstrapEmail : "" } },
  });
}

describe("Identity signup role assignment", () => {
  afterEach(() => { Reflect.deleteProperty(globalThis, "Netlify"); });

  it("keeps every ordinary public signup pending until manager approval", async () => {
    setNetlifyEnv("owner@example.com");
    const result = await handler({ body: JSON.stringify({ user: { email: "new@example.com", app_metadata: {} } }) } as never, {} as never, () => undefined);
    expect(result?.statusCode).toBe(200);
    expect(JSON.parse(result?.body || "{}").app_metadata.roles).toEqual(["pending"]);
  });

  it("bootstraps only the exact configured manager email", async () => {
    setNetlifyEnv("owner@example.com");
    const result = await handler({ body: JSON.stringify({ user: { email: "OWNER@example.com", app_metadata: {} } }) } as never, {} as never, () => undefined);
    expect(JSON.parse(result?.body || "{}").app_metadata.roles).toEqual(["manager"]);
  });
});
