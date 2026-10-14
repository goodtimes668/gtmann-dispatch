import { beforeEach, expect, it, vi } from "vitest";
import { notifyAssignment, notifyNewBooking, notifyReturn, notifyStatus } from "../netlify/functions/_shared/slack";
import type { Booking } from "../netlify/functions/_shared/types";

const env: Record<string, string> = {};
const calls: Array<{ method: string; body: any }> = [];
let lookup: any;
let post: any;
const booking = (extra: Partial<Booking> = {}) => ({
  id: "booking-1", requester: "Ryan", requesterEmail: " Ryan@Example.com ",
  requesterId: "identity-1", type: "delivery", status: "approved", site: "Grand & Fir",
  date: "2026-10-15", description: "Plywood", returnItem: "Saw", ...extra,
}) as Booking;

beforeEach(() => {
  calls.length = 0;
  Object.keys(env).forEach((key) => delete env[key]);
  Object.assign(env, { DISPATCH_SLACK_BOT_TOKEN: "test-token", SLACK_MANAGER_CHANNEL_ID: "CSHARED", BRENT_SLACK_ID: "UBRENT" });
  lookup = { ok: true, user: { id: "UCREATOR" } };
  post = { ok: true };
  vi.stubGlobal("Netlify", { env: { get: (key: string) => env[key] } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options: RequestInit) => {
    const method = url.split("/").pop()!;
    const body = String(options.body);
    calls.push({ method, body: body.startsWith("{") ? JSON.parse(body) : Object.fromEntries(new URLSearchParams(body)) });
    return Response.json(method === "users.lookupByEmail" ? lookup : post);
  }));
});

it("DMs every web-booking event to the creator matched by authenticated email", async () => {
  await notifyNewBooking(booking());
  for (const status of ["approved", "declined", "in-progress", "completed"] as const) {
    await notifyStatus(booking({ status }));
  }
  await notifyAssignment(booking());
  await notifyReturn(booking());
  const posts = calls.filter((call) => call.method === "chat.postMessage");
  expect(posts).toHaveLength(7);
  expect(posts.every((call) => call.body.channel === "UCREATOR")).toBe(true);
  expect(calls.filter((call) => call.method === "users.lookupByEmail").every((call) => call.body.email === "ryan@example.com")).toBe(true);
  expect(posts[0].body.blocks).toBeDefined();
});

it("uses the saved Slack creator ID even when email lookup is unavailable", async () => {
  lookup = { ok: false, error: "missing_scope" };
  await notifyStatus(booking({ slackUserId: "USLACKCREATOR" }));
  expect(calls).toEqual([{ method: "chat.postMessage", body: expect.objectContaining({ channel: "USLACKCREATOR" }) }]);
});

it.each(["users_not_found", "missing_scope", "invalid_auth"])("does not broadcast when email lookup fails: %s", async (error) => {
  lookup = { ok: false, error };
  expect(await notifyNewBooking(booking())).toMatchObject({ ok: false });
  await notifyStatus(booking());
  await notifyAssignment(booking());
  await notifyReturn(booking());
  expect(calls.every((call) => call.method === "users.lookupByEmail")).toBe(true);
});

it("does not use a shared channel stored in place of a Slack user ID", async () => {
  await notifyStatus(booking({ slackUserId: "CSHARED" }));
  expect(calls.at(-1)?.body.channel).toBe("UCREATOR");
});

it("reports a rejected DM without falling back to manager or Brent", async () => {
  post = { ok: false, error: "channel_not_found" };
  expect(await notifyNewBooking(booking())).toMatchObject(post);
  expect(calls.filter((call) => call.method === "chat.postMessage")).toHaveLength(1);
});

it("skips optional Slack delivery when the token or requester identity is missing", async () => {
  delete env.DISPATCH_SLACK_BOT_TOKEN;
  await notifyNewBooking(booking());
  env.DISPATCH_SLACK_BOT_TOKEN = "test-token";
  await notifyStatus(booking({ requesterEmail: "" }));
  expect(calls).toHaveLength(0);
});
