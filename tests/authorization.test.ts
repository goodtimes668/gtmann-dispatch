import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, verifyRequestOrigin } = vi.hoisted(() => ({
  getUser: vi.fn(),
  verifyRequestOrigin: vi.fn(),
}));

vi.mock("@netlify/identity", () => ({ getUser, verifyRequestOrigin }));

import { requireSameOrigin, requireUser } from "../netlify/functions/_shared/auth";

describe("server authorization", () => {
  beforeEach(() => { getUser.mockReset(); verifyRequestOrigin.mockReset(); });

  it("rejects unauthenticated access", async () => {
    getUser.mockResolvedValue(null);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });

  it("defaults confirmed users without elevated metadata to member", async () => {
    getUser.mockResolvedValue({ id: "user-1", email: "member@example.com", name: "Member", roles: [] });
    await expect(requireUser()).resolves.toMatchObject({ roles: ["member"] });
  });

  it("does not allow a member through dispatcher authorization", async () => {
    getUser.mockResolvedValue({ id: "user-1", email: "member@example.com", roles: ["member"] });
    await expect(requireUser(["dispatcher", "manager"])).rejects.toMatchObject({ status: 403 });
  });

  it("gives managers dispatcher capability", async () => {
    getUser.mockResolvedValue({ id: "manager-1", email: "manager@example.com", roles: ["manager"] });
    await expect(requireUser(["dispatcher"])).resolves.toMatchObject({ roles: ["manager", "dispatcher"] });
  });

  it("turns origin-verification failures into a controlled 403", () => {
    verifyRequestOrigin.mockImplementation(() => { throw new Error("bad origin"); });
    expect(() => requireSameOrigin(new Request("https://example.test/api"))).toThrow(expect.objectContaining({ status: 403 }));
  });
});
