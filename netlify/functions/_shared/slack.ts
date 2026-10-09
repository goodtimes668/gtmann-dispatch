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

type SlackResult = { ok?: boolean; error?: string; channel?: { id?: string } } & Record<string, unknown>;

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

async function notificationChannel() {
  const brentId = Netlify.env.get("BRENT_SLACK_ID");
  if (brentId) {
    const opened = await slackCall("conversations.open", { users: brentId });
    if (opened?.ok && opened.channel?.id) return opened.channel.id;
  }
  return Netlify.env.get("SLACK_MANAGER_CHANNEL_ID") || null;
}

export async function notifyNewBooking(booking: Booking) {
  // Deliver each saved request to the material-handling team, plus configured manager and Brent targets.
  const targets = new Set<string>(["C090X2NSHLY"]);
  const managerChannel = Netlify.env.get("SLACK_MANAGER_CHANNEL_ID")?.trim();
  if (managerChannel) targets.add(managerChannel);
  const brentId = Netlify.env.get("BRENT_SLACK_ID")?.trim();
  if (brentId) {
    const opened = await slackCall("conversations.open", { users: brentId });
    if (opened?.ok && opened.channel?.id) targets.add(opened.channel.id);
  }
  const type = labels[booking.type] || booking.type;
  const priority = booking.priority === "urgent" ? "URGENT" : booking.priority === "scheduled" ? "Planned" : "Normal";
  const blocks = [
            { type: "header", text: { type: "plain_text", text: "New Dispatch Request" } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Type:*\n${mrkdwn(type)}` },
        { type: "mrkdwn", text: `*From:*\n${mrkdwn(booking.requester)}` },
        { type: "mrkdwn", text: `*Site:*\n${mrkdwn(booking.site || "TBD")}` },
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
  await Promise.all([...targets].map((channel) => slackCall("chat.postMessage", {
    channel,
    text: `New dispatch request from ${mrkdwn(booking.requester)}`,
    blocks,
  })));
}

export async function notifyStatus(booking: Booking) {
  const channel = Netlify.env.get("SLACK_MANAGER_CHANNEL_ID") || await notificationChannel();
  if (!channel) return;
  const type = labels[booking.type] || booking.type;
  const messages: Partial<Record<Booking["status"], string>> = {
    approved: `Booking approved: ${type} for ${booking.site} on ${booking.date}`,
    declined: `Booking declined: ${type} for ${booking.site}`,
    "in-progress": `Dispatch started: ${type} for ${booking.site}`,
    completed: `Job completed: ${type} for ${booking.site}`,
  };
  const text = messages[booking.status];
  if (text) await slackCall("chat.postMessage", { channel, text: mrkdwn(text) });
}

export async function notifyAssignment(booking: Booking) {
  const channel = Netlify.env.get("SLACK_MANAGER_CHANNEL_ID") || await notificationChannel();
  if (!channel) return;
  const truck = booking.vehicle ? booking.vehicle.replace("-", " ") : "no truck set";
  await slackCall("chat.postMessage", {
    channel,
    text: `Dispatch assignment updated: ${booking.assignedDriver || "driver not set"} · ${truck} · ${booking.site || "no site"} · ${booking.date}`,
  });
}

export async function notifyReturn(booking: Booking) {
  const channel = Netlify.env.get("SLACK_MANAGER_CHANNEL_ID") || await notificationChannel();
  if (!channel) return;
  await slackCall("chat.postMessage", {
    channel,
    text: `Equipment returned: ${booking.returnItem} from ${booking.site || booking.pickupLocation || "dispatch"}`,
  });
}
