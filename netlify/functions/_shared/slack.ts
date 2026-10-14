import type { Booking } from "./types";

const labels = {
  delivery: "Material Delivery",
  pickup: "Tool Pickup",
  "tool-delivery": "Tool Delivery",
  misc: "Misc Task",
};

function mrkdwn(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 2500);
}

function requestedTime(booking: Booking) {
  if (booking.time) return `at ${booking.time}`;
  if (booking.timeWindow === "morning" || booking.timeWindow === "afternoon") return `in the ${booking.timeWindow}`;
  return "time flexible";
}

type SlackResult = { ok?: boolean; error?: string; channel?: { id?: string }; user?: { id?: string } } & Record<string, unknown>;

export async function slackCall(method: string, body: Record<string, unknown>) {
  const token = Netlify.env.get("DISPATCH_SLACK_BOT_TOKEN");
  if (!token) return null;
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as SlackResult;
  if (!result.ok) console.error(`Slack ${method} failed`, result.error);
  return result;
}

// Some read methods (users.info among them) only accept form-encoded arguments.
export async function slackForm(method: string, params: Record<string, string>) {
  const token = Netlify.env.get("DISPATCH_SLACK_BOT_TOKEN");
  if (!token) return null;
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const result = await response.json() as SlackResult;
  if (!result.ok) console.error(`Slack ${method} failed`, result.error);
  return result;
}

// Direct message to one Slack member, used to confirm or fail a request made from Slack.
export async function notifySlackUser(slackUserId: string, text: string) {
  return slackCall("chat.postMessage", { channel: slackUserId, text: mrkdwn(text) });
}

// Resolve only server-owned requester fields; never fall back to a shared channel.
async function requesterSlackId(booking: Booking): Promise<string | null> {
  if (!Netlify.env.get("DISPATCH_SLACK_BOT_TOKEN")) return null;
  const savedId = booking.slackUserId?.trim();
  if (savedId && /^[UW][A-Z0-9]+$/.test(savedId)) return savedId;
  const email = booking.requesterEmail?.trim().toLowerCase();
  if (!email) {
    console.error("Slack requester DM skipped", "requester email missing");
    return null;
  }
  const result = await slackForm("users.lookupByEmail", { email });
  const id = result?.ok ? result.user?.id : null;
  return id && /^[UW][A-Z0-9]+$/.test(id) ? id : null;
}

async function notifyRequester(booking: Booking, text: string) {
  const id = await requesterSlackId(booking);
  if (!id) return { ok: false, error: "requester Slack account unavailable" };
  return notifySlackUser(id, text);
}

export async function notifyNewBooking(booking: Booking, requesterNote = "") {
  const channel = await requesterSlackId(booking);
  if (!channel) return { ok: false, error: "requester Slack account unavailable" };
  const type = labels[booking.type] || booking.type;
  const priority = booking.priority === "urgent" ? "URGENT" : booking.priority === "scheduled" ? "Planned" : "Normal";
  const blocks = [
            { type: "header", text: { type: "plain_text", text: "New Dispatch Request" } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Type:*\n${mrkdwn(type)}` },
        { type: "mrkdwn", text: `*From:*\n${mrkdwn(booking.requester)}` },
        { type: "mrkdwn", text: `*Site:*\n${mrkdwn(booking.site || "TBD")}` },
        { type: "mrkdwn", text: `*Address:*\n${mrkdwn(booking.siteAddress || "Not provided")}` },
        { type: "mrkdwn", text: `*Date:*\n${mrkdwn(booking.date)} · ${mrkdwn(requestedTime(booking))}` },
        { type: "mrkdwn", text: `*Priority:*\n${mrkdwn(priority)}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: [
        `*Description:*\n${mrkdwn(booking.description)}`,
        booking.onsiteContact ? `*On-site contact:* ${mrkdwn(booking.onsiteContact)}` : "",
        booking.helperRequired ? "*Helper:* requested at site" : "",
        booking.returnItem ? `*Return:* ${mrkdwn(booking.returnItem)} by ${mrkdwn(booking.expectedReturnDate)}` : "",
      ].filter(Boolean).join("\n") } },
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "Open Dispatch" }, url: Netlify.env.get("DISPATCH_APP_URL") || Netlify.env.get("URL") || "https://gtmann-dispatch.netlify.app/", action_id: "open_dispatch_app" },
      ] },
    ];
  if (requesterNote) blocks.push({ type: "section", text: { type: "mrkdwn", text: mrkdwn(requesterNote) } });
  return slackCall("chat.postMessage", {
    channel,
    text: `Request submitted: ${mrkdwn(type)} for ${mrkdwn(booking.site || "TBD")} on ${mrkdwn(booking.date)}${requesterNote ? `\n${mrkdwn(requesterNote)}` : ""}`,
    blocks,
  });
}

export async function notifyStatus(booking: Booking) {
  const type = labels[booking.type] || booking.type;
  const messages: Partial<Record<Booking["status"], string>> = {
    approved: `Booking approved: ${type} for ${booking.site} on ${booking.date}`,
    declined: `Booking declined: ${type} for ${booking.site}`,
    "in-progress": `Dispatch started: ${type} for ${booking.site}`,
    completed: [
      `Job completed: ${type} for ${booking.site}`,
      booking.receivedBy ? `Received by: ${booking.receivedBy}` : "",
      booking.completionNotes ? `Proof notes: ${booking.completionNotes}` : "",
      booking.completionPhotoId ? "Completion photo attached in Dispatch." : "",
    ].filter(Boolean).join("\n"),
  };
  const text = messages[booking.status];
  if (!text) return;
  return notifyRequester(booking, text);
}

export async function notifyAssignment(booking: Booking) {
  const truck = booking.vehicle ? booking.vehicle.replace("-", " ") : "no truck set";
  return notifyRequester(booking, `Dispatch assignment updated: ${booking.assignedDriver || "driver not set"} · ${truck} · ${booking.site || "no site"} · ${booking.date}`);
}

export async function notifyReturn(booking: Booking) {
  return notifyRequester(booking, `Equipment returned: ${booking.returnItem} from ${booking.site || booking.pickupLocation || "dispatch"}`);
}
