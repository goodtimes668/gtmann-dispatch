import type { Booking } from "./types";

const labels: Record<Booking["type"], string> = {
  delivery: "Material Delivery",
  pickup: "Tool Pickup",
  "tool-delivery": "Tool Delivery",
  misc: "Misc Task",
};

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function calendarText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function isoLocal(timestamp: number) {
  const date = new Date(timestamp);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    + `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00`;
}

function bookingWindow(booking: Pick<Booking, "date" | "time" | "estMinutes">) {
  const [year, month, day] = booking.date.split("-").map(Number);
  if (!booking.time) {
    const start = Date.UTC(year, month - 1, day);
    return { start: isoLocal(start), end: isoLocal(start + 24 * 60 * 60 * 1000), allDay: true };
  }

  const [hour, minute] = booking.time.split(":").map(Number);
  const start = Date.UTC(year, month - 1, day, hour, minute);
  const duration = Math.max(30, Math.round(booking.estMinutes || 60));
  return { start: isoLocal(start), end: isoLocal(start + duration * 60 * 1000), allDay: false };
}

export function outlookCalendarUrl(booking: Booking) {
  const window = bookingWindow(booking);
  const type = labels[booking.type] || booking.type;
  const body = [
    `Dispatch request from ${calendarText(booking.requester, 120)}`,
    calendarText(booking.description, 800),
    booking.pickupLocation ? `Pickup: ${calendarText(booking.pickupLocation, 240)}` : "",
    booking.notes ? `Notes: ${calendarText(booking.notes, 300)}` : "",
    `Priority: ${booking.priority}`,
  ].filter(Boolean).join("\n\n");

  const location = calendarText(booking.site || booking.pickupLocation, 240);
  const siteLabel = calendarText(booking.site, 160) || "Site TBD";

  const url = new URL("https://outlook.office.com/calendar/0/deeplink/compose");
  url.searchParams.set("path", "/calendar/action/compose");
  url.searchParams.set("rru", "addevent");
  url.searchParams.set("subject", `Dispatch – ${type} – ${siteLabel}`);
  url.searchParams.set("startdt", window.start);
  url.searchParams.set("enddt", window.end);
  url.searchParams.set("allday", String(window.allDay));
  url.searchParams.set("location", location);
  url.searchParams.set("body", body);
  return url.toString();
}
