import type { Config, Context } from "@netlify/functions";
import { recordAudit } from "./_shared/audit";
import { matchBundles } from "./_shared/bundles";
import { estimateDispatch } from "./_shared/cost";
import { allowMethods, handleError, HttpError, json } from "./_shared/http";
import { once } from "./_shared/idempotency";
import { enforceRateLimit } from "./_shared/rate-limit";
import { notifyNewBooking, notifySlackUser, slackCall } from "./_shared/slack";
import {
  BOOKING_MODAL_CALLBACK,
  NEW_BOOKING_SHORTCUT,
  buildNewBookingModal,
  errorBlockFor,
  resolveRequester,
  submissionToBookingInput,
  verifySlackSignature,
  type SlackActor,
} from "./_shared/slack-inbound";
import { createBookingRecord, listBookings, listSites } from "./_shared/stores";
import type { Booking } from "./_shared/types";
import { validateBookingInput } from "./_shared/validation";

// Receives the GT Mann Dispatch Slack app's interactive requests (the "New
// Dispatch Booking" shortcut and its form) and writes the booking into the same
// Blobs store the web app reads. There is no sync step: a submitted form is a
// booking in the app as soon as this function finishes.

const MAX_BODY_BYTES = 256 * 1024;
const ack = () => new Response(null, { status: 200 });

type BookingInput = ReturnType<typeof validateBookingInput>;

async function readRawBody(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
  const raw = await req.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
  return raw;
}

function parsePayload(raw: string) {
  try {
    const payload = JSON.parse(new URLSearchParams(raw).get("payload") || "");
    if (!payload || typeof payload !== "object") throw new Error("empty");
    return payload as Record<string, any>;
  } catch {
    throw new HttpError(400, "Invalid Slack payload");
  }
}

function appUrl() {
  return Netlify.env.get("DISPATCH_APP_URL") || Netlify.env.get("URL") || "https://gtmann-dispatch.netlify.app/";
}

const typeLabels = { delivery: "Material Delivery", pickup: "Tool Pickup", "tool-delivery": "Tool Delivery", misc: "Misc Task" };

async function saveSlackBooking(actor: SlackActor, viewId: string, input: BookingInput, context: Context) {
  try {
    await enforceRateLimit(`slack:${actor.id}`, "booking-create", 20);
    const { user, linked } = await resolveRequester(actor);
    // Slack can deliver the same submission twice; the modal's view ID makes the write happen once.
    const result = await once(`slack-booking/${actor.id}`, viewId, async () => {
      const [all, sites] = await Promise.all([listBookings(), listSites()]);
      const site = sites.find((item) => item.name.toLowerCase() === input.site.toLowerCase());
      const now = new Date().toISOString();
      const booking: Booking = {
        id: crypto.randomUUID(),
        version: 1,
        status: "pending",
        requester: user.name,
        requesterEmail: user.email,
        requesterId: user.id,
        brentNotes: "",
        bundleStatus: "none",
        bundleWithId: null,
        createdAt: now,
        updatedAt: now,
        ...input,
        // Use the saved site's exact name so cost estimates and bundling match typed input.
        site: site?.name || input.site,
        ...estimateDispatch(input.type, site),
        source: "slack",
        slackUserId: actor.id,
      };
      await matchBundles(booking, all);
      const created = await createBookingRecord(booking);
      if (!created.modified) throw new HttpError(409, "Booking ID collision. Please retry.");
      return { status: 201, value: booking };
    });
    if (result.replayed) return;

    const booking = result.value;
    await Promise.allSettled([
      notifyNewBooking(booking),
      recordAudit(user, "booking.created", "booking", booking.id, context, { status: booking.status, site: booking.site, source: "slack", linkedAccount: linked }),
      notifySlackUser(actor.id, [
        `Request submitted: ${typeLabels[booking.type]}${booking.site ? ` for ${booking.site}` : ""} on ${booking.date}.`,
        linked
          ? `Track it in Dispatch: ${appUrl()}`
          : `Sign up in Dispatch with your Slack email to track or edit it: ${appUrl()}`,
      ].join("\n")),
    ]);
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      service: "gtmann-dispatch",
      event: "slack_booking_failed",
      requestId: context.requestId,
      slackUserId: actor.id,
      occurredAt: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }));
    const reason = error instanceof HttpError && error.status === 429 ? "Too many requests in a short time." : "It could not be saved.";
    await notifySlackUser(actor.id, `Your dispatch request did not go through. ${reason} Please submit it again or use the app: ${appUrl()}`).catch(() => undefined);
  }
}

async function retiredButtonNotice(responseUrl: unknown) {
  // Cards posted by the previous Slack backend still carry Approve/Decline buttons.
  if (typeof responseUrl !== "string" || !responseUrl.startsWith("https://hooks.slack.com/")) return;
  await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text: `Approvals now happen in the Dispatch app: ${appUrl()}` }),
  }).catch(() => undefined);
}

export default async (req: Request, context: Context) => {
  try {
    allowMethods(req, ["POST"]);
    // Trim so a stray space or newline pasted with the secret cannot break every signature check.
    const secret = (Netlify.env.get("DISPATCH_SLACK_SIGNING_SECRET") || "").trim();
    if (!secret) {
      console.error("DISPATCH_SLACK_SIGNING_SECRET is not set; Slack requests are rejected");
      throw new HttpError(503, "Slack requests are not configured");
    }
    const raw = await readRawBody(req);
    const signed = verifySlackSignature({
      secret,
      signature: req.headers.get("x-slack-signature"),
      timestamp: req.headers.get("x-slack-request-timestamp"),
      rawBody: raw,
    });
    if (!signed) {
      // Never log the secret or the signature themselves; this is enough to tell a wrong secret from a missing header.
      const timestamp = req.headers.get("x-slack-request-timestamp");
      console.warn(JSON.stringify({
        level: "warn",
        service: "gtmann-dispatch",
        event: "slack_request_rejected",
        requestId: context.requestId,
        occurredAt: new Date().toISOString(),
        hasSignature: Boolean(req.headers.get("x-slack-signature")),
        hasTimestamp: Boolean(timestamp),
        clockSkewSeconds: timestamp && /^\d+$/.test(timestamp) ? Math.floor(Date.now() / 1000) - Number(timestamp) : null,
        secretLength: secret.length,
        bodyBytes: raw.length,
        hint: "Signature did not match. DISPATCH_SLACK_SIGNING_SECRET must be the Signing Secret of the Slack app whose Request URL points here.",
      }));
      throw new HttpError(401, "Invalid Slack signature");
    }

    const payload = parsePayload(raw);
    const actor: SlackActor = { id: String(payload.user?.id || ""), username: payload.user?.username, name: payload.user?.name };
    if (!/^[A-Z0-9]{2,30}$/.test(actor.id)) throw new HttpError(400, "Invalid Slack payload");

    console.log(JSON.stringify({
      level: "info",
      service: "gtmann-dispatch",
      event: "slack_interaction",
      requestId: context.requestId,
      type: String(payload.type || ""),
      callbackId: String(payload.callback_id || payload.view?.callback_id || ""),
      slackUserId: actor.id,
    }));

    if (payload.type === "shortcut") {
      if (payload.callback_id === NEW_BOOKING_SHORTCUT && payload.trigger_id) {
        // The trigger expires three seconds after the shortcut is used, so open the form before anything else.
        try {
          const opened = await slackCall("views.open", { trigger_id: payload.trigger_id, view: buildNewBookingModal() });
          if (!opened) console.error("Slack form not opened: DISPATCH_SLACK_BOT_TOKEN is not set");
          else if (!opened.ok) console.error("Slack views.open rejected", JSON.stringify({ error: opened.error, detail: opened.response_metadata }));
        }
        catch (error) { console.error("Slack views.open error", error instanceof Error ? error.message : String(error)); }
      }
      return ack();
    }

    if (payload.type === "view_submission" && payload.view?.callback_id === BOOKING_MODAL_CALLBACK) {
      let input: BookingInput;
      try {
        input = validateBookingInput(submissionToBookingInput(payload.view?.state?.values));
      } catch (error) {
        if (error instanceof HttpError && error.status === 422) {
          return json({ response_action: "errors", errors: { [errorBlockFor(error.message)]: error.message } });
        }
        throw error;
      }
      // Slack needs an answer within three seconds. The form is already validated, so
      // close it now and finish the save in the background; the requester gets a DM either way.
      const viewId = typeof payload.view?.id === "string" && payload.view.id ? payload.view.id : crypto.randomUUID();
      context.waitUntil(saveSlackBooking(actor, viewId, input, context));
      return json({ response_action: "clear" });
    }

    if (payload.type === "block_actions") {
      const actionId = payload.actions?.[0]?.action_id;
      if (actionId === "approve_booking" || actionId === "decline_booking") context.waitUntil(retiredButtonNotice(payload.response_url));
      return ack();
    }

    return ack();
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/slack/interactions" };
