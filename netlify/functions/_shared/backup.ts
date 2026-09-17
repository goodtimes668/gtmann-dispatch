import { auditStore, backupsStore, bookingsStore, getBackupSnapshot, listAuditEvents, listBookings, listPhotoIds, listSites, photoLinksStore, photosStore, saveBackupSnapshot, sitesStore } from "./stores";
import type { BackupSnapshot } from "./types";

async function inBatches<T>(items: T[], work: (item: T) => Promise<void>, size = 10) {
  for (let index = 0; index < items.length; index += size) {
    await Promise.all(items.slice(index, index + size).map(work));
  }
}

export async function createBackup(createdBy: BackupSnapshot["createdBy"]) {
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}`;
  const [bookings, sites, audit, photoIds] = await Promise.all([
    listBookings(),
    listSites(),
    listAuditEvents(500),
    listPhotoIds(),
  ]);
  const snapshot: BackupSnapshot = {
    schemaVersion: 2,
    id,
    createdAt: new Date().toISOString(),
    createdBy,
    bookings,
    sites,
    audit,
    photoIds,
  };
  await inBatches(photoIds, async (photoId) => {
    const photo = await photosStore().getWithMetadata(`photo/${photoId}`, { type: "arrayBuffer" });
    if (photo) await backupsStore().set(
      `photo/${id}/${photoId}`,
      photo.data as ArrayBuffer,
      photo.metadata ? { metadata: photo.metadata } : undefined,
    );
  });
  // Publish the manifest only after every attachment copy succeeds.
  await saveBackupSnapshot(snapshot);
  return snapshot;
}

export async function restoreBackup(id: string) {
  const snapshot = await getBackupSnapshot(id);
  if (!snapshot || ![1, 2].includes(snapshot.schemaVersion)) throw new Error("Backup not found or unsupported");

  await inBatches(snapshot.bookings, async (booking) => {
    await bookingsStore().setJSON(`booking/${booking.id}`, booking);
    if (booking.photoId) await photoLinksStore().setJSON(`photo/${booking.photoId}`, { bookingId: booking.id });
  });
  await inBatches(snapshot.sites, async (site) => {
    await sitesStore().setJSON(`site/${encodeURIComponent(site.name.trim().toLowerCase())}`, site);
  });
  await inBatches(snapshot.audit, async (event) => {
    const reverseTime = String(9_999_999_999_999 - Date.parse(event.occurredAt)).padStart(13, "0");
    await auditStore().setJSON(`event/${reverseTime}-${event.id}`, event);
  });
  await inBatches(snapshot.photoIds, async (photoId) => {
    const photo = await backupsStore().getWithMetadata(`photo/${id}/${photoId}`, { type: "arrayBuffer" });
    if (photo) await photosStore().set(
      `photo/${photoId}`,
      photo.data as ArrayBuffer,
      photo.metadata ? { metadata: photo.metadata } : undefined,
    );
  });
  return snapshot;
}
