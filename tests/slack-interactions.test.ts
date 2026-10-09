import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { blobs, listUsers } = vi.hoisted(() => ({
  blobs: new Map<string, Map<string, { value: unknown; etag: string }>>(),
  listUsers: vi.fn(),
}));

// In-memory stand-in for Netlify Blobs with the conditional writes the app relies on.
vi.mock("@netlify/blobs", () => ({
  getStore: ({ name }: { name: string }) => {
    if (!blobs.has(name)) blobs.set(name, new Map());
    const data = blobs.get(name)!;
    let counter = 0;
    return {
      get: async (key: string) => data.get(key)?.value ?? null,
      getWithMetadata: async (key: string) => {
        const hit = data.get(key);
        return hit ? { data: hit.value, etag: hit.etag, metadata: {} } : null;
      },
      setJSON: async (key: string, value: unknown, options: { onlyIfNew?: boolean; onlyIfMatch?: string } = {}) => {
        const hit = data.get(key);
        if (options.onlyIfNew && hit) return { modified: false };
        if (options.onlyIfMatch && hit?.etag !== options.onlyIfMatch) return { modified: false };
        const etag = `${name}-${key}-${counter += 1}`;
        data.set(key, { value: JSON.parse(JSON.stringify(value)), etag });
        return { modified: true, etag };
      },
      list: async ({ prefix = "" }: { prefix?: string } = {}) => ({
        blobs: [...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => ({ key })),
      }),
      delete: async (key: string) => { data.delete(key); },
    };
  },
}));

vi.mock("@netlify/identity", () => ({ admin: { listUsers }, getUser: vi.fn(), verifyRequestOrigin: vi.fn() }));

import handler from "../netlify/functions/slack-interactions";
import { ownsBooking } from "../netlify/functions/_shared/auth";
import { buildNewBookingModal, errorBlockFor, verifySlackSignature } from "../netlify/functions/_shared/slack-inbound";

const SECRET = "test-signing-secret";
const env: Record<string, string> = {};
const slackCalls: Array<{ method: string; body: any }> = [];
let slackProfile: { email?: string; real_name?: string } | null = { email: "Ryan@Example.com", real_name: "Ryan J" };

function sign(body: string, timestamp = Math.floor(Date.now() / 1000), secret = SECRET) {
  return `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
}

function slackRequest(payload: unknown, options: { signature?: string; timestamp?: number } = {}) {
  const body = new URLSearchParams({ payload: JSON.stringify(payload) }).toString();
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  return new Request("https://gtmann-dispatch.netlify.app/api/slack/interactions", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": options.signature ?? sign(body, timestamp),
    },
    body,
  });
}

function makeContext() {
  const pending: Promise<unknown>[] = [];
  return {
    context: { waitUntil: (work: Promise<unknown>) => { pending.push(work); }, requestId: "req-1", ip: "203.0.113.5", params: {} } as any,
    settle: () => Promise.all(pending),
  };
}

function submission(overrides: Record<string, unknown> = {}, viewId = "V100") {
  const fields = { type: "delivery", site: "grand & fir", pickup: "", desc: "20 sheets of 5/8 ply", date: "2026-10-09", time: "", priority: "normal", notes: "Gate code 1234", ...overrides } as Record<string, string>;
  return {
    type: "view_submission",
    user: { id: "U123ABC", username: "ryan" },
    view: {
      id: viewId,
      callback_id: "booking_submit",
      state: { values: {
        type_block: { type_select: { selected_option: { value: fields.type } } },
        site_block: { site_input: { value: fields.site } },
        pickup_block: { pickup_input: { value: fields.pickup } },
        desc_block: { desc_input: { value: fields.desc } },
        date_block: { date_input: { selected_date: fields.date } },
        time_block: { time_input: { selected_time: fields.time || null } },
        priority_block: { priority_select: { selected_option: { value: fields.priority } } },
        notes_block: { notes_input: { value: fields.notes } },
      } },
    },
  };
}

const savedBookings = () => [...(blobs.get("dispatch-bookings")?.entries() || [])]
  .filter(([key]) => key.startsWith("booking/"))
  .map(([, entry]) => entry.value as any);

beforeEach(() => {
  blobs.clear();
  slackCalls.length = 0;
  listUsers.mockReset();
  listUsers.mockResolvedValue([]);
  slackProfile = { email: "Ryan@Example.com", real_name: "Ryan J" };
  Object.keys(env).forEach((key) => delete env[key]);
  Object.assign(env, { DISPATCH_SLACK_SIGNING_SECRET: SECRET, DISPATCH_SLACK_BOT_TOKEN: "xoxb-test", BRENT_SLACK_ID: "UBRENT", DISPATCH_APP_URL: "https://gtmann-dispatch.netlify.app/" });
  vi.stubGlobal("Netlify", { env: { get: (key: string) => env[key] } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const method = String(url).replace("https://slack.com/api/", "");
    const type = (init.headers as Record<string, string>)["Content-Type"] || "";
    const body = type.includes("json") ? JSON.parse(String(init.body)) : Object.fromEntries(new URLSearchParams(String(init.body)));
    slackCalls.push({ method, body });
    if (method === "users.info") {
      return Response.json(slackProfile ? { ok: true, user: { real_name: slackProfile.real_name, profile: { email: slackProfile.email } } } : { ok: false, error: "missing_scope" });
    }
    if (method === "conversations.open") return Response.json({ ok: true, channel: { id: "DBRENT" } });
    return Response.json({ ok: true });
  }));
});

describe("Slack signature verification", () => {
  const now = 1_800_000_000_000;
  const timestamp = String(now / 1000);
  const rawBody = "payload=%7B%7D";
  const signature = sign(rawBody, now / 1000);

  it("accepts a correctly signed request", () => {
    expect(verifySlackSignature({ secret: SECRET, signature, timestamp, rawBody, now })).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, and missing headers", () => {
    expect(verifySlackSignature({ secret: SECRET, signature, timestamp, rawBody: `${rawBody}x`, now })).toBe(false);
    expect(verifySlackSignature({ secret: "other-secret", signature, timestamp, rawBody, now })).toBe(false);
    expect(verifySlackSignature({ secret: SECRET, signature: null, timestamp, rawBody, now })).toBe(false);
    expect(verifySlackSignature({ secret: SECRET, signature, timestamp: null, rawBody, now })).toBe(false);
    expect(verifySlackSignature({ secret: "", signature, timestamp, rawBody, now })).toBe(false);
  });

  it("rejects a replayed request older than five minutes", () => {
    expect(verifySlackSignature({ secret: SECRET, signature, timestamp, rawBody, now: now + 301_000 })).toBe(false);
  });
});

describe("Slack interactions endpoint", () => {
  it("rejects unsigned requests without touching storage", async () => {
    const { context, settle } = makeContext();
    const response = await handler(slackRequest(submission(), { signature: "v0=deadbeef" }), context);
    await settle();
    expect(response.status).toBe(401);
    expect(savedBookings()).toHaveLength(0);
    expect(slackCalls).toHaveLength(0);
  });

  it("refuses to run when the signing secret is not configured", async () => {
    delete env.DISPATCH_SLACK_SIGNING_SECRET;
    const { context } = makeContext();
    const response = await handler(slackRequest(submission()), context);
    expect(response.status).toBe(503);
    expect(savedBookings()).toHaveLength(0);
  });

  it("opens the request form when the shortcut is used", async () => {
    const { context } = makeContext();
    const response = await handler(slackRequest({ type: "shortcut", callback_id: "new_booking_shortcut", trigger_id: "trig-1", user: { id: "U123ABC" } }), context);
    expect(response.status).toBe(200);
    expect(slackCalls).toHaveLength(1);
    expect(slackCalls[0].method).toBe("views.open");
    expect(slackCalls[0].body.trigger_id).toBe("trig-1");
    expect(slackCalls[0].body.view.callback_id).toBe("booking_submit");
  });

  it("saves a submitted form as a pending booking owned by the matching Dispatch account", async () => {
    listUsers.mockResolvedValue([{ id: "identity-1", email: "ryan@example.com", name: "Ryan Jones", roles: ["dispatcher"], confirmedAt: "2026-09-01T00:00:00Z" }]);
    const { context, settle } = makeContext();
    const response = await handler(slackRequest(submission()), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ response_action: "clear" });
    await settle();

    const [booking] = savedBookings();
    expect(savedBookings()).toHaveLength(1);
    expect(booking).toMatchObject({
      status: "pending",
      version: 1,
      type: "delivery",
      priority: "normal",
      site: "Grand & Fir", // canonical name of the seeded site, not the typed casing
      description: "20 sheets of 5/8 ply",
      date: "2026-10-09",
      time: "",
      timeWindow: "anytime",
      notes: "Gate code 1234",
      requester: "Ryan Jones",
      requesterEmail: "ryan@example.com",
      requesterId: "identity-1",
      source: "slack",
      slackUserId: "U123ABC",
      photoId: null,
      bundleStatus: "none",
    });
    expect(booking.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(booking.estCost).toBeGreaterThan(0);

    const posts = slackCalls.filter((call) => call.method === "chat.postMessage");
    expect(posts.some((call) => call.body.channel === "DBRENT" && call.body.blocks)).toBe(true);
    expect(posts.some((call) => call.body.channel === "U123ABC" && /Request submitted/.test(call.body.text))).toBe(true);

    const audit = [...blobs.get("dispatch-audit")!.values()].map((entry) => entry.value as any);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "booking.created", targetId: booking.id, actorId: "identity-1", details: { source: "slack", linkedAccount: true } });
  });

  it("still saves the request when the Slack user has no Dispatch account, and lets them claim it by email", async () => {
    const { context, settle } = makeContext();
    await handler(slackRequest(submission()), context);
    await settle();

    const [booking] = savedBookings();
    expect(booking).toMatchObject({ requesterId: "slack:U123ABC", requesterEmail: "Ryan@Example.com", requester: "Ryan J", status: "pending" });
    expect(ownsBooking(booking, { id: "identity-9", email: "ryan@example.com" })).toBe(true);
    expect(ownsBooking(booking, { id: "identity-9", email: "someone-else@example.com" })).toBe(false);
    expect(slackCalls.some((call) => call.body.channel === "U123ABC" && /Sign up in Dispatch/.test(call.body.text))).toBe(true);
  });

  it("does not link to an unconfirmed account", async () => {
    listUsers.mockResolvedValue([{ id: "identity-2", email: "ryan@example.com", roles: [] }]);
    const { context, settle } = makeContext();
    await handler(slackRequest(submission()), context);
    await settle();
    expect(savedBookings()[0].requesterId).toBe("slack:U123ABC");
  });

  it("saves the request even when the Slack profile lookup is not permitted", async () => {
    slackProfile = null;
    const { context, settle } = makeContext();
    await handler(slackRequest(submission()), context);
    await settle();
    expect(savedBookings()[0]).toMatchObject({ requesterId: "slack:U123ABC", requesterEmail: "", requester: "ryan" });
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("never treats an unlinked Slack request with no email as claimable", () => {
    expect(ownsBooking({ requesterId: "slack:U1", requesterEmail: "" }, { id: "identity-9", email: "" })).toBe(false);
    expect(ownsBooking({ requesterId: "identity-1", requesterEmail: "a@example.com" }, { id: "identity-9", email: "a@example.com" })).toBe(false);
    expect(ownsBooking({ requesterId: "identity-1", requesterEmail: "a@example.com" }, { id: "identity-1", email: "b@example.com" })).toBe(true);
  });

  it("returns field errors to the form instead of saving an invalid request", async () => {
    const { context, settle } = makeContext();
    const noSite = await handler(slackRequest(submission({ site: "" })), context);
    expect(await noSite.json()).toEqual({ response_action: "errors", errors: { site_block: "Job site is required for deliveries" } });
    const noPickup = await handler(slackRequest(submission({ type: "pickup", site: "", pickup: "" })), context);
    expect(await noPickup.json()).toEqual({ response_action: "errors", errors: { pickup_block: "Pickup location is required" } });
    await settle();
    expect(savedBookings()).toHaveLength(0);
  });

  it("stores a duplicate delivery of the same submission only once", async () => {
    const first = makeContext();
    const second = makeContext();
    await handler(slackRequest(submission({}, "V777")), first.context);
    await first.settle();
    await handler(slackRequest(submission({}, "V777")), second.context);
    await second.settle();
    expect(savedBookings()).toHaveLength(1);
    expect(slackCalls.filter((call) => call.body.channel === "U123ABC")).toHaveLength(1);
  });

  it("tells the requester when the save fails", async () => {
    const { context, settle } = makeContext();
    blobs.set("dispatch-bookings", new Map());
    const original = blobs.get("dispatch-bookings")!;
    original.set = () => { throw new Error("blob store unavailable"); };
    const response = await handler(slackRequest(submission()), context);
    expect(await response.json()).toEqual({ response_action: "clear" });
    await settle();
    expect(savedBookings()).toHaveLength(0);
    expect(slackCalls.some((call) => call.body.channel === "U123ABC" && /did not go through/.test(call.body.text))).toBe(true);
  });

  it("acknowledges button clicks and points retired approve buttons at the app", async () => {
    const { context, settle } = makeContext();
    const open = await handler(slackRequest({ type: "block_actions", user: { id: "UBRENT" }, actions: [{ action_id: "open_dispatch_app" }] }), context);
    expect(open.status).toBe(200);
    const approve = await handler(slackRequest({ type: "block_actions", user: { id: "UBRENT" }, actions: [{ action_id: "approve_booking", value: "abc" }], response_url: "https://hooks.slack.com/actions/T1/2/3" }), context);
    await settle();
    expect(approve.status).toBe(200);
    expect(savedBookings()).toHaveLength(0);
    const calls = (fetch as any).mock.calls.map((call: unknown[]) => String(call[0]));
    expect(calls).toContain("https://hooks.slack.com/actions/T1/2/3");
  });
});

describe("Slack diagnostics", () => {
  const traces = () => [...(blobs.get("dispatch-slack-diagnostics")?.values() || [])].map((entry) => entry.value as any);

  it("opens the form for a shortcut saved under a different callback ID", async () => {
    const { context, settle } = makeContext();
    await handler(slackRequest({ type: "shortcut", callback_id: "new_booking", trigger_id: "trig-2", api_app_id: "A0APP", user: { id: "U123ABC" } }), context);
    await settle();
    expect(slackCalls.map((call) => call.method)).toEqual(["views.open"]);
    expect(traces()).toEqual([expect.objectContaining({ event: "form_open", ok: true, callbackId: "new_booking", appId: "A0APP" })]);
  });

  it("records why the form did not open", async () => {
    (fetch as any).mockImplementationOnce(async () => Response.json({ ok: false, error: "invalid_auth" }));
    const { context, settle } = makeContext();
    await handler(slackRequest({ type: "shortcut", callback_id: "new_booking_shortcut", trigger_id: "trig-3", user: { id: "U123ABC" } }), context);
    await settle();
    expect(traces()).toEqual([expect.objectContaining({ event: "form_open", ok: false, error: "invalid_auth" })]);
  });

  it("records a rejected signature with the calling app but nothing secret", async () => {
    const { context, settle } = makeContext();
    const request = slackRequest({ type: "shortcut", api_app_id: "A0OTHER", user: { id: "U123ABC" } }, { signature: "v0=deadbeef" });
    expect((await handler(request, context)).status).toBe(401);
    await settle();
    const [trace] = traces();
    expect(trace).toMatchObject({ event: "rejected_bad_signature", claimedAppId: "A0OTHER", hasSignature: true, secretLength: SECRET.length });
    expect(JSON.stringify(trace)).not.toContain(SECRET);
    expect(JSON.stringify(trace)).not.toContain("deadbeef");
  });

  it("records the outcome of a saved request", async () => {
    const { context, settle } = makeContext();
    await handler(slackRequest(submission()), context);
    await settle();
    expect(traces().map((trace) => trace.event).sort()).toEqual(["booking_saved", "form_submitted", "requester_dm"]);
    expect(JSON.stringify(traces())).not.toContain("20 sheets");
  });

  it("serves the readout only with the configured key", async () => {
    const { default: diagnostics } = await import("../netlify/functions/slack-diagnostics");
    const url = "https://gtmann-dispatch.netlify.app/api/slack/diagnostics";
    expect((await diagnostics(new Request(`${url}?key=anything`))).status).toBe(404);
    env.SLACK_DIAGNOSTICS_KEY = "k".repeat(32);
    expect((await diagnostics(new Request(url))).status).toBe(404);
    expect((await diagnostics(new Request(`${url}?key=${"x".repeat(32)}`))).status).toBe(404);
    (fetch as any).mockImplementation(async (target: string) => String(target).endsWith("auth.test")
      ? new Response(JSON.stringify({ ok: true, team: "GT Mann", user: "dispatch", user_id: "UBOT", bot_id: "B1" }), { headers: { "x-oauth-scopes": "chat:write,im:write" } })
      : Response.json({ ok: true, bot: { app_id: "A0APP", name: "Dispatch" } }));
    const response = await diagnostics(new Request(`${url}?key=${"k".repeat(32)}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.botToken).toMatchObject({ valid: true, appId: "A0APP", missingScopes: ["users:read", "users:read.email"] });
    expect(body.signingSecret).toEqual({ configured: true, length: SECRET.length });
    expect(JSON.stringify(body)).not.toContain("xoxb-test");
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

describe("Slack request form", () => {
  it("uses unique block IDs that every validation message maps onto", () => {
    const blockIds = buildNewBookingModal().blocks.map((block) => block.block_id);
    expect(new Set(blockIds).size).toBe(blockIds.length);
    ["Job site is required for deliveries", "Pickup location is required", "Invalid booking type", "Invalid priority", "Invalid time", "Invalid date", "Notes is too long", "Description is required"]
      .forEach((message) => expect(blockIds).toContain(errorBlockFor(message)));
  });
});

describe("Slack endpoint diagnostics", () => {
  it("accepts a secret that was saved with stray whitespace", async () => {
    env.DISPATCH_SLACK_SIGNING_SECRET = ` ${SECRET}\n`;
    const { context } = makeContext();
    const response = await handler(slackRequest({ type: "shortcut", callback_id: "new_booking_shortcut", trigger_id: "trig-2", user: { id: "U123ABC" } }), context);
    expect(response.status).toBe(200);
    expect(slackCalls[0]?.method).toBe("views.open");
  });

  it("logs a rejected request without leaking the secret or signature", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { context } = makeContext();
    const response = await handler(slackRequest(submission(), { signature: "v0=deadbeef" }), context);
    expect(response.status).toBe(401);
    const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("slack_request_rejected");
    expect(logged).not.toContain(SECRET);
    expect(logged).not.toContain("deadbeef");
    warn.mockRestore();
  });
});
