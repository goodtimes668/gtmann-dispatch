import { describe, expect, it } from "vitest";
import locations from "../netlify/functions/locations";
import route from "../netlify/functions/route";
import sites from "../netlify/functions/sites";
import bookings from "../netlify/functions/bookings";
import photos from "../netlify/functions/photos";
import users from "../netlify/functions/users";
import managerSummary from "../netlify/functions/manager-summary";
import backups from "../netlify/functions/backups";
import audit from "../netlify/functions/audit";
import health from "../netlify/functions/health";
import scheduledBackup from "../netlify/functions/backup-scheduled";

describe("address function entry points", () => {
  it("loads the location, route, and site handlers", () => {
    expect(locations).toBeTypeOf("function");
    expect(route).toBeTypeOf("function");
    expect(sites).toBeTypeOf("function");
  });

  it("loads every protected production handler", () => {
    [bookings, photos, users, managerSummary, backups, audit, health, scheduledBackup]
      .forEach((handler) => expect(handler).toBeTypeOf("function"));
  });
});
