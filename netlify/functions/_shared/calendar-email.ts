import type { Booking } from "./types";

const APPROVAL_RECIPIENT = "brent.vandusen@gtmann.com";
const CALENDAR_TIME_ZONE = "America/Vancouver";

const typeLabels: Record<Booking["type"], string> = {
  delivery: "Material Delivery",
  pickup: "Tool Pickup",
  "tool-delivery": "Tool Delivery",
  misc: "Misc Task",
};

function calendarEscape(value: unknown) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactDate(value: string) {
  return value.replace(/-/g, "");
}

function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

function addMinutes(date: string, time: string, minutes: number) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes));
  return {
    date: result.toISOString().slice(0, 10),
    time: result.toISOString().slice(11, 16),
  };
}

function localDateTime(date: string, time: string) {
  return `${compactDate(date)}T${time.replace(":", "")}00`;
}

function utcStamp(value: string | undefined) {
  const date = value ? new Date(value) : new Date();
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function descriptionLines(booking: Booking) {
  return [
    `Type: ${typeLabels[booking.type]}`,
    `Requested by: ${booking.requester}`,
    booking.pickupLocation ? `Pickup: ${booking.pickupLocation}` : "",
    booking.description ? `Description: ${booking.description}` : "",
    booking.notes ? `Request notes: ${booking.notes}` : "",
    booking.brentNotes ? `Dispatcher notes: ${booking.brentNotes}` : "",
  ].filter(Boolean).join("\n");
}

export function buildApprovalCalendar(booking: Booking) {
  const summary = `GT Mann Dispatch - ${typeLabels[booking.type]} - ${booking.site}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GT Mann//Dispatch//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  if (booking.time) {
    const end = addMinutes(booking.date, booking.time, 60);
    lines.push(
      "BEGIN:VTIMEZONE",
      `TZID:${CALENDAR_TIME_ZONE}`,
      `X-LIC-LOCATION:${CALENDAR_TIME_ZONE}`,
      "BEGIN:DAYLIGHT",
      "TZOFFSETFROM:-0800",
      "TZOFFSETTO:-0700",
      "TZNAME:PDT",
      "DTSTART:19700308T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
      "END:DAYLIGHT",
      "BEGIN:STANDARD",
      "TZOFFSETFROM:-0700",
      "TZOFFSETTO:-0800",
      "TZNAME:PST",
      "DTSTART:19701101T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      `DTSTART;TZID=${CALENDAR_TIME_ZONE}:${localDateTime(booking.date, booking.time)}`,
      `DTEND;TZID=${CALENDAR_TIME_ZONE}:${localDateTime(end.date, end.time)}`,
    );
  } else {
    lines.push(
      "BEGIN:VEVENT",
      `DTSTART;VALUE=DATE:${compactDate(booking.date)}`,
      `DTEND;VALUE=DATE:${compactDate(addDays(booking.date, 1))}`,
    );
  }

  lines.push(
    `UID:${calendarEscape(booking.id)}@gtmann-dispatch.netlify.app`,
    `DTSTAMP:${utcStamp(booking.approvedAt || booking.updatedAt)}`,
    `SUMMARY:${calendarEscape(summary)}`,
    `LOCATION:${calendarEscape(booking.site)}`,
    `DESCRIPTION:${calendarEscape(descriptionLines(booking))}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR",
  );

  return `${lines.join("\r\n")}\r\n`;
}

function graphConfig() {
  const tenantId = Netlify.env.get("MICROSOFT_TENANT_ID");
  const clientId = Netlify.env.get("MICROSOFT_CLIENT_ID");
  const clientSecret = Netlify.env.get("MICROSOFT_CLIENT_SECRET");
  const sender = Netlify.env.get("MICROSOFT_GRAPH_SENDER");
  if (!tenantId || !clientId || !clientSecret || !sender) return null;
  return { tenantId, clientId, clientSecret, sender };
}

async function graphToken(config: NonNullable<ReturnType<typeof graphConfig>>) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(`Microsoft token request failed (${response.status}): ${result.error || "unknown error"}`);
  return result.access_token;
}

export async function notifyApprovalCalendar(booking: Booking) {
  const config = graphConfig();
  if (!config) {
    console.warn("Approval email skipped: Microsoft Graph environment variables are incomplete");
    return false;
  }

  const token = await graphToken(config);
  const calendar = buildApprovalCalendar(booking);
  const type = typeLabels[booking.type];
  const when = booking.time ? `${booking.date} at ${booking.time}` : booking.date;
  const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: `Approved dispatch: ${type} - ${booking.site}`,
        body: {
          contentType: "HTML",
          content: `<p>A dispatch request has been approved.</p><p><strong>${htmlEscape(type)}</strong><br>${htmlEscape(booking.site)}<br>${htmlEscape(when)}</p><p>Open the attached calendar file to add it to Outlook.</p>`,
        },
        toRecipients: [{ emailAddress: { address: APPROVAL_RECIPIENT } }],
        attachments: [{
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: `gtmann-dispatch-${booking.date}.ics`,
          contentType: "text/calendar; charset=utf-8; method=PUBLISH",
          contentBytes: Buffer.from(calendar, "utf8").toString("base64"),
        }],
      },
      saveToSentItems: true,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Microsoft Graph sendMail failed (${response.status}): ${detail}`);
  }
  return true;
}
