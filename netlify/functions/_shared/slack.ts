import type { Booking } from "./types";
import { outlookCalendarUrl } from "./outlook";

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

async function slackCall(method: string, body: Record<string, unknown>) {
  const token = Netlify.env.get("DISPATCH_SLACK_BOT_TOKEN");
  if (!token) return null;
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { ok?: boolean; error?: string; channel?: { id?: string } };
  if (!result.ok) console.error(`Slack ${method} failed`, result.error);
  return result;
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
  const channel = await notificationChannel();
  if (!channel) return;
  const type = labels[booking.type] || booking.type;
  const priority = booking.priority === "urgent" ? "URGENT" : booking.priority === "scheduled" ? "Planned" : "Normal";
  await slackCall("chat.postMessage", {
    channel,
    text: `New dispatch request from ${mrkdwn(booking.requester)}`,
    blocks: [
      { type: "header", text: { type: "plain_text", text: "New Dispatch Request" } },
      { type: "section", fields: [
        { type: "mrkdwn", text: `*Type:*\n${mrkdwn(type)}` },
        { type: "mrkdwn", text: `*From:*\n${mrkdwn(booking.requester)}` },
        { type: "mrkdwn", text: `*Site:*\n${mrkdwn(booking.site || "TBD")}` },
        { type: "mrkdwn", text: `*Date:*\n${mrkdwn(booking.date)}${booking.time ? ` at ${mrkdwn(booking.time)}` : ""}` },
        { type: "mrkdwn", text: `*Priority:*\n${mrkdwn(priority)}` },
      ] },
      { type: "section", text: { type: "mrkdwn", text: `*Description:*\n${mrkdwn(booking.description)}` } },
      { type: "actions", elements: [
        { type: "button", text: { type: "plain_text", text: "Open Dispatch" }, url: Netlify.env.get("DISPATCH_APP_URL") || Netlify.env.get("URL") || "https://gtmann-dispatch.netlify.app/", action_id: "open_dispatch_app" },
      ] },
    ],
  });
}

export async function notifyStatus(booking: Booking) {
  const channel = Netlify.env.get("SLACK_MANAGER_CHANNEL_ID") || await notificationChannel();
  if (!channel) return;
  const type = labels[booking.type] || booking.type;
  const messages: Partial<Record<Booking["status"], string>> = {
    approved: `Booking approved: ${type} for ${booking.site} on ${booking.date}`,
    declined: `Booking declined: ${type} for ${booking.site}`,
    "in-progress": `Brent is on the way: ${type} for ${booking.site}`,
    completed: `Job completed: ${type} for ${booking.site}`,
  };
  const text = messages[booking.status];
  if (!text) return;
  if (booking.status === "approved") {
    await slackCall("chat.postMessage", {
      channel,
      text: mrkdwn(text),
      blocks: [
        { type: "section", text: { type: "mrkdwn", text: `*${mrkdwn(text)}*` } },
        { type: "actions", elements: [
          { type: "button", text: { type: "plain_text", text: "Add to Outlook Calendar" }, url: outlookCalendarUrl(booking), action_id: "add_dispatch_to_outlook" },
          { type: "button", text: { type: "plain_text", text: "Open Dispatch" }, url: Netlify.env.get("DISPATCH_APP_URL") || Netlify.env.get("URL") || "https://gtmann-dispatch.netlify.app/", action_id: "open_dispatch_app" },
        ] },
      ],
    });
    return;
  }
  await slackCall("chat.postMessage", { channel, text: mrkdwn(text) });
}
