import { getStore } from "@netlify/blobs";
import type { Booking, Site } from "./types";

export const bookingsStore = () => getStore({ name: "dispatch-bookings", consistency: "strong" });
export const sitesStore = () => getStore({ name: "dispatch-sites", consistency: "strong" });
export const photosStore = () => getStore({ name: "dispatch-photos", consistency: "strong" });
export const idempotencyStore = () => getStore({ name: "dispatch-idempotency", consistency: "strong" });
export const rateLimitStore = () => getStore({ name: "dispatch-rate-limits", consistency: "strong" });

const seedSites = [
  { name: "Grand & Fir", min: 20, km: 14 },
  { name: "GT Mann Office", min: 10, km: 6 },
  { name: "Warehouse", min: 6, km: 3 },
];

export async function listBookings(): Promise<Booking[]> {
  const store = bookingsStore();
  const { blobs } = await store.list({ prefix: "booking/" });
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json" }) as Promise<Booking | null>));
  return records.filter((record): record is Booking => Boolean(record));
}

export async function getBooking(id: string): Promise<Booking | null> {
  return (await bookingsStore().get(`booking/${id}`, { type: "json" })) as Booking | null;
}

export async function getBookingVersioned(id: string): Promise<{ booking: Booking; etag: string } | null> {
  const result = await bookingsStore().getWithMetadata(`booking/${id}`, { type: "json" });
  if (!result?.etag) return null;
  return { booking: result.data as Booking, etag: result.etag };
}

export async function createBookingRecord(booking: Booking) {
  return bookingsStore().setJSON(`booking/${booking.id}`, booking, { onlyIfNew: true });
}

export async function saveBooking(booking: Booking) {
  await bookingsStore().setJSON(`booking/${booking.id}`, booking);
}

export async function saveBookingIfMatch(booking: Booking, etag: string) {
  return bookingsStore().setJSON(`booking/${booking.id}`, booking, { onlyIfMatch: etag });
}

export async function deleteBookingRecord(id: string) {
  await bookingsStore().delete(`booking/${id}`);
}

export async function listSites(): Promise<Site[]> {
  const store = sitesStore();
  let { blobs } = await store.list({ prefix: "site/" });
  if (!blobs.length) {
    const now = new Date().toISOString();
    await Promise.all(seedSites.map((site) => {
      const record: Site = { ...site, version: 1, createdAt: now, updatedAt: now };
      return store.setJSON(`site/${encodeURIComponent(site.name.toLowerCase())}`, record);
    }));
    ({ blobs } = await store.list({ prefix: "site/" }));
  }
  const records = await Promise.all(blobs.map(({ key }) => store.get(key, { type: "json" }) as Promise<Site | null>));
  return records.filter((record): record is Site => Boolean(record)).sort((a, b) => a.name.localeCompare(b.name));
}

export function siteKey(name: string) {
  return `site/${encodeURIComponent(name.trim().toLowerCase())}`;
}

export async function saveSite(site: Site, oldName?: string) {
  const store = sitesStore();
  if (oldName && oldName.toLowerCase() !== site.name.toLowerCase()) await store.delete(siteKey(oldName));
  await store.setJSON(siteKey(site.name), site);
}

export async function deleteSiteRecord(name: string) {
  await sitesStore().delete(siteKey(name));
}
