import type { Config } from "@netlify/functions";
import { createBackup } from "./_shared/backup";

export default async () => {
  const snapshot = await createBackup("scheduled");
  console.log(JSON.stringify({
    level: "info",
    service: "gtmann-dispatch",
    event: "scheduled_backup_complete",
    backupId: snapshot.id,
    createdAt: snapshot.createdAt,
    bookings: snapshot.bookings.length,
    sites: snapshot.sites.length,
    photos: snapshot.photoIds.length,
  }));
};

export const config: Config = { schedule: "@daily" };
