import { getStore } from "@netlify/blobs";
import type { AuditEvent, BackupSnapshot, Booking, InventoryItem, Site } from "./types";

export const bookingsStore = () => getStore({ name: "dispatch-bookings", consistency: "strong" });
export const sitesStore = () => getStore({ name: "dispatch-sites", consistency: "strong" });
export const photosStore = () => getStore({ name: "dispatch-photos", consistency: "strong" });
export const idempotencyStore = () => getStore({ name: "dispatch-idempotency", consistency: "strong" });
export const rateLimitStore = () => getStore({ name: "dispatch-rate-limits", consistency: "strong" });
export const auditStore = () => getStore({ name: "dispatch-audit", consistency: "strong" });
export const backupsStore = () => getStore({ name: "dispatch-backups", consistency: "strong" });
export const photoLinksStore = () => getStore({ name: "dispatch-photo-links", consistency: "strong" });
export const inventoryStore = () => getStore({ name: "dispatch-inventory", consistency: "strong" });

const seedSites = [
  { name: "Grand & Fir", min: 20, km: 14 },
  { name: "GT Mann Office", min: 10, km: 6 },
  { name: "Warehouse", min: 6, km: 3 },
];

const seedInventory: Array<Omit<InventoryItem, "id" | "version" | "submittedBy" | "submittedById" | "createdAt" | "updatedAt">> = [
  { name: "Formply sheets", category: "formwork", tracking: "transferable", quantity: 0, unit: "sheets", location: "Faithwood Farms", condition: "good", notes: "Set quantity after Brent finishes the master count.", status: "active" },
  { name: "2x4 lumber", category: "formwork", tracking: "consumable", quantity: 0, unit: "pieces", location: "Faithwood Farms", condition: "mixed", notes: "Track bundles and usable offcuts separately once counted.", status: "active" },
  { name: "Temp power panels", category: "temp-power", tracking: "returnable", quantity: 0, unit: "panels", location: "Faithwood Farms", condition: "serviceable", notes: "Requires return date when sent to site.", status: "active" },
  { name: "Extension cords", category: "temp-power", tracking: "returnable", quantity: 0, unit: "cords", location: "Faithwood Farms", condition: "serviceable", notes: "Confirm length and condition before dispatch.", status: "active" },
  { name: "General tool inventory", category: "tools", tracking: "returnable", quantity: 0, unit: "tools", location: "Faithwood Farms", condition: "mixed", notes: "Replace with individual asset records as tools are tagged.", status: "active" },
];

async function readJsonInBatches<T>(store: ReturnType<typeof bookingsStore>, keys: string[], batchSize = 25) {
  const records: Array<T | null> = [];
  for (let index = 0; index < keys.length; index += batchSize) {
    const batch = await Promise.all(keys.slice(index, index + batchSize).map((key) => store.get(key, { type: "json" }) as Promise<T | null>));
    records.push(...batch);
  }
  return records;
}

export async function listBookings(): Promise<Booking[]> {
  const store = bookingsStore();
  const { blobs } = await store.list({ prefix: "booking/" });
  // Bound concurrent Blob reads so a long history cannot exhaust function memory or connections.
  const records = await readJsonInBatches<Booking>(store, blobs.map(({ key }) => key));
  return records.filter((record): record is Booking => Boolean(record));
}

export async function findBookingByPhotoId(photoId: string): Promise<Booking | null> {
  const link = await photoLinksStore().get(`photo/${photoId}`, { type: "json" }) as { bookingId?: string } | null;
  if (link?.bookingId) return getBooking(link.bookingId);

  // Repair links created before the index existed. This fallback runs once per legacy photo.
  const booking = (await listBookings()).find((item) => item.photoId === photoId) || null;
  if (booking) await bindPhotoToBooking(photoId, booking.id);
  return booking;
}

export async function bindPhotoToBooking(photoId: string, bookingId: string) {
  await photoLinksStore().setJSON(`photo/${photoId}`, { bookingId });
}

export async function unbindPhoto(photoId: string) {
  await photoLinksStore().delete(`photo/${photoId}`);
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
  return records.filter((record): record is Site => Boolean(record) && !record.deletedAt).sort((a, b) => a.name.localeCompare(b.name));
}

export function inventoryKey(id: string) {
  return `item/${encodeURIComponent(id)}`;
}

async function seedInventoryIfEmpty() {
  const store = inventoryStore();
  const { blobs } = await store.list({ prefix: "item/" });
  if (blobs.length) return blobs;

  const now = new Date().toISOString();
  await Promise.all(seedInventory.map((item) => {
    const id = crypto.randomUUID();
    const record: InventoryItem = {
      ...item,
      id,
      version: 1,
      submittedBy: "System",
      submittedById: "system",
      createdAt: now,
      updatedAt: now,
    };
    return store.setJSON(inventoryKey(id), record);
  }));
  return (await store.list({ prefix: "item/" })).blobs;
}

export async function listInventory(): Promise<InventoryItem[]> {
  const store = inventoryStore();
  const blobs = await seedInventoryIfEmpty();
  const records = await readJsonInBatches<InventoryItem>(store, blobs.map(({ key }) => key));
  return records
    .filter((record): record is InventoryItem => Boolean(record) && !record.deletedAt)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

export async function getInventoryItemVersioned(id: string): Promise<{ item: InventoryItem; etag: string } | null> {
  const result = await inventoryStore().getWithMetadata(inventoryKey(id), { type: "json" });
  if (!result?.etag) return null;
  return { item: result.data as InventoryItem, etag: result.etag };
}

export async function createInventoryRecord(item: InventoryItem) {
  return inventoryStore().setJSON(inventoryKey(item.id), item, { onlyIfNew: true });
}

export async function saveInventoryIfMatch(item: InventoryItem, etag: string) {
  return inventoryStore().setJSON(inventoryKey(item.id), item, { onlyIfMatch: etag });
}

export async function deleteInventoryIfMatch(item: InventoryItem, etag: string) {
  const tombstone: InventoryItem = { ...item, version: item.version + 1, updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString() };
  const write = await inventoryStore().setJSON(inventoryKey(item.id), tombstone, { onlyIfMatch: etag });
  if (!write.modified) return write;
  await inventoryStore().delete(inventoryKey(item.id));
  return write;
}

export function siteKey(name: string) {
  return `site/${encodeURIComponent(name.trim().toLowerCase())}`;
}

export async function getSiteVersioned(name: string): Promise<{ site: Site; etag: string } | null> {
  const result = await sitesStore().getWithMetadata(siteKey(name), { type: "json" });
  if (!result?.etag) return null;
  return { site: result.data as Site, etag: result.etag };
}

export async function createSiteRecord(site: Site) {
  return sitesStore().setJSON(siteKey(site.name), site, { onlyIfNew: true });
}

export async function saveSiteIfMatch(site: Site, oldName: string, etag: string) {
  const store = sitesStore();
  if (oldName.toLowerCase() === site.name.toLowerCase()) {
    return store.setJSON(siteKey(site.name), site, { onlyIfMatch: etag });
  }

  // Write the renamed record first. If deletion fails, duplicate data is safer than data loss.
  const created = await store.setJSON(siteKey(site.name), site, { onlyIfNew: true });
  if (!created.modified) return created;
  await store.delete(siteKey(oldName));
  return created;
}

export async function deleteSiteIfMatch(site: Site, etag: string) {
  const store = sitesStore();
  const tombstone: Site = { ...site, version: site.version + 1, updatedAt: new Date().toISOString(), deletedAt: new Date().toISOString() };
  const write = await store.setJSON(siteKey(site.name), tombstone, { onlyIfMatch: etag });
  if (!write.modified) return write;
  // A failed physical delete leaves an invisible tombstone rather than reviving stale data.
  await store.delete(siteKey(site.name));
  return write;
}

export async function listAuditEvents(limit = 200): Promise<AuditEvent[]> {
  const store = auditStore();
  const { blobs } = await store.list({ prefix: "event/" });
  const selected = blobs.sort((a, b) => a.key.localeCompare(b.key)).slice(0, Math.max(1, Math.min(limit, 500)));
  const records = await readJsonInBatches<AuditEvent>(store, selected.map(({ key }) => key));
  return records.filter((record): record is AuditEvent => Boolean(record));
}

export async function listPhotoIds(): Promise<string[]> {
  const { blobs } = await photosStore().list({ prefix: "photo/" });
  return blobs.map(({ key }) => key.slice("photo/".length)).filter(Boolean);
}

export async function saveBackupSnapshot(snapshot: BackupSnapshot) {
  await backupsStore().setJSON(`snapshot/${snapshot.id}`, snapshot, {
    metadata: { createdAt: snapshot.createdAt, createdBy: snapshot.createdBy, schemaVersion: snapshot.schemaVersion },
  });
}

export async function getBackupSnapshot(id: string): Promise<BackupSnapshot | null> {
  return backupsStore().get(`snapshot/${id}`, { type: "json" }) as Promise<BackupSnapshot | null>;
}

export async function listBackupSnapshots() {
  const store = backupsStore();
  const { blobs } = await store.list({ prefix: "snapshot/" });
  const selected = blobs.sort((a, b) => b.key.localeCompare(a.key)).slice(0, 30);
  return Promise.all(selected.map(async ({ key }) => {
    const metadata = await store.getMetadata(key);
    return { id: key.slice("snapshot/".length), ...(metadata?.metadata || {}) };
  }));
}