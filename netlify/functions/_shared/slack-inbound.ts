import { createHmac, timingSafeEqual } from "node:crypto";
import { admin } from "@netlify/identity";
import { slackForm } from "./slack";
import type { AuthUser, DispatchRole } from "./types";

// Slack signs every interactive request with the app's signing secret. The
// signature covers the exact raw body, so it must be checked before parsing.
export function verifySlackSignature(input: {
  secret: string;
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  now?: number;
}) {
  const { secret, signature, timestamp, rawBody } = input;
  if (!secret || !signature || !timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  // Reject anything outside a five-minute window so a captured request cannot be replayed.
  if (Math.abs(nowSeconds - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(`v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${rawBody}`, "utf8").digest("hex")}`, "utf8");
  const received = Buffer.from(signature, "utf8");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function todayInVancouver() {
  // en-CA formats as YYYY-MM-DD, which is what Slack's datepicker expects.
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const plain = (text: string) => ({ type: "plain_text", text });
const option = (text: string, value: string) => ({ text: plain(text), value });

export const BOOKING_MODAL_CALLBACK = "booking_submit";
export const NEW_BOOKING_SHORTCUT = "new_booking_shortcut";

export function buildNewBookingModal() {
  return {
    type: "modal",
    callback_id: BOOKING_MODAL_CALLBACK,
    title: plain("New Dispatch Request"),
    submit: plain("Submit"),
    close: plain("Cancel"),
    blocks: [
      {
        type: "input",
        block_id: "type_block",
        label: plain("Type"),
        element: {
          type: "static_select",
          action_id: "type_select",
          initial_option: option("Material Delivery", "delivery"),
          options: [
            option("Material Delivery", "delivery"),
            option("Tool Pickup", "pickup"),
            option("Tool Delivery", "tool-delivery"),
            option("Misc Task", "misc"),
          ],
        },
      },
      {
        type: "input",
        block_id: "site_block",
        optional: true,
        label: plain("Job Site"),
        hint: plain("Required for deliveries."),
        element: { type: "plain_text_input", action_id: "site_input", max_length: 120, placeholder: plain("e.g. Grand & Fir") },
      },
      {
        type: "input",
        block_id: "pickup_block",
        optional: true,
        label: plain("Pickup Location"),
        hint: plain("Required for tool pickups and tool deliveries."),
        element: { type: "plain_text_input", action_id: "pickup_input", max_length: 240, placeholder: plain("Where is it being picked up from?") },
      },
      {
        type: "input",
        block_id: "desc_block",
        label: plain("Description"),
        element: { type: "plain_text_input", action_id: "desc_input", multiline: true, max_length: 3000, placeholder: plain("What needs to be picked up or delivered?") },
      },
      {
        type: "input",
        block_id: "date_block",
        label: plain("Date"),
        element: { type: "datepicker", action_id: "date_input", initial_date: todayInVancouver() },
      },
      {
        type: "input",
        block_id: "time_block",
        optional: true,
        label: plain("Time (optional)"),
        element: { type: "timepicker", action_id: "time_input" },
      },
      {
        type: "input",
        block_id: "priority_block",
        label: plain("Priority"),
        element: {
          type: "radio_buttons",
          action_id: "priority_select",
          initial_option: option("Normal", "normal"),
          options: [option("Urgent", "urgent"), option("Normal", "normal"), option("Planned", "scheduled")],
        },
      },
      {
        type: "input",
        block_id: "notes_block",
        optional: true,
        label: plain("Notes (optional)"),
        element: { type: "plain_text_input", action_id: "notes_input", multiline: true, max_length: 2000 },
      },
    ],
  };
}

type SlackValues = Record<string, Record<string, {
  value?: string | null;
  selected_date?: string | null;
  selected_time?: string | null;
  selected_option?: { value?: string } | null;
}>>;

// Turns Slack's modal state into the same request body the web app posts, so
// one validator (validateBookingInput) decides what a valid booking is.
export function submissionToBookingInput(values: SlackValues | undefined) {
  const v = values || {};
  return {
    type: v.type_block?.type_select?.selected_option?.value || "delivery",
    priority: v.priority_block?.priority_select?.selected_option?.value || "normal",
    site: v.site_block?.site_input?.value || "",
    pickupLocation: v.pickup_block?.pickup_input?.value || "",
    description: v.desc_block?.desc_input?.value || "",
    date: v.date_block?.date_input?.selected_date || "",
    time: v.time_block?.time_input?.selected_time || "",
    notes: v.notes_block?.notes_input?.value || "",
  };
}

// Slack shows a validation message under the block it is keyed to.
export function errorBlockFor(message: string) {
  if (/job site/i.test(message)) return "site_block";
  if (/pickup location/i.test(message)) return "pickup_block";
  if (/booking type/i.test(message)) return "type_block";
  if (/priority/i.test(message)) return "priority_block";
  if (/time/i.test(message)) return "time_block";
  if (/date/i.test(message)) return "date_block";
  if (/notes/i.test(message)) return "notes_block";
  return "desc_block";
}

export type SlackActor = { id: string; username?: string; name?: string };
export type ResolvedRequester = { user: AuthUser; linked: boolean };

const knownRoles = new Set<DispatchRole>(["member", "dispatcher", "manager"]);

async function findConfirmedAccount(email: string) {
  const wanted = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const users = await admin.listUsers({ page, perPage: 100 });
    const match = users.find((user) => user.email?.toLowerCase() === wanted && user.confirmedAt);
    if (match) return match;
    if (users.length < 100) return null;
  }
  return null;
}

// A Slack submission has no Dispatch session, so the requester is resolved from
// the Slack profile email. With a matching confirmed account the booking belongs
// to that account exactly as if it were created in the app. Without one it is
// still saved, held under the Slack identity, and claimed by email on sign-up
// (see ownsBooking). A lookup failure never blocks the request itself.
export async function resolveRequester(actor: SlackActor): Promise<ResolvedRequester> {
  let email = "";
  let slackName = "";
  try {
    const info = await slackForm("users.info", { user: actor.id }) as {
      ok?: boolean;
      user?: { real_name?: string; profile?: { email?: string; real_name?: string; display_name?: string } };
    } | null;
    if (info?.ok) {
      email = (info.user?.profile?.email || "").trim();
      slackName = info.user?.real_name || info.user?.profile?.real_name || info.user?.profile?.display_name || "";
    }
  } catch (error) {
    console.error("Slack users.info lookup failed", error instanceof Error ? error.message : String(error));
  }

  if (email) {
    try {
      const account = await findConfirmedAccount(email);
      if (account) {
        const roles = (account.roles || []).filter((role): role is DispatchRole => knownRoles.has(role as DispatchRole));
        if (!roles.length) roles.push("member");
        return {
          linked: true,
          user: { id: account.id, email: account.email || email, name: account.name || slackName || email.split("@")[0], roles },
        };
      }
    } catch (error) {
      console.error("Dispatch account lookup failed", error instanceof Error ? error.message : String(error));
    }
  }

  return {
    linked: false,
    user: {
      id: `slack:${actor.id}`,
      email,
      name: (slackName || actor.name || actor.username || "Slack user").slice(0, 120),
      roles: ["member"],
    },
  };
}
