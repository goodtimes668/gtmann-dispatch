import { saveBooking } from "./stores";
import type { Booking } from "./types";

// Shared by every path that creates a booking (web app and Slack form) so a
// bundle request is matched the same way regardless of where it came from.
export async function matchBundles(newBooking: Booking, all: Booking[]) {
  if (newBooking.bundleRequested) {
    const match = all
      .filter((item) => item.site === newBooking.site && !item.bundleRequested && !["declined", "completed"].includes(item.status) && item.date >= newBooking.date)
      .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
    if (match) {
      newBooking.bundleStatus = "matched";
      newBooking.bundleWithId = match.id;
    }
  } else if (newBooking.site) {
    const waiting = all.filter((item) => item.site === newBooking.site && item.bundleStatus === "queued" && item.date <= newBooking.date);
    await Promise.all(waiting.map(async (item) => {
      item.bundleStatus = "matched";
      item.bundleWithId = newBooking.id;
      item.updatedAt = new Date().toISOString();
      item.version += 1;
      await saveBooking(item);
    }));
  }
}
