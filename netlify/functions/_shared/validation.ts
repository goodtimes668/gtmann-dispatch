import { HttpError } from "./http";
import type { BookingPriority, BookingStatus, BookingType, Site } from "./types";

const bookingTypes = new Set<BookingType>(["delivery", "pickup", "tool-delivery", "misc"]);
const priorities = new Set<BookingPriority>(["urgent", "normal", "scheduled"]);
const statuses = new Set<BookingStatus>(["pending", "approved", "declined", "in-progress", "completed"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) { return uuidPattern.test(value); }
export function isBookingId(value: string) { return isUuid(value) || /^legacy-[A-Za-z0-9_-]{1,100}$/.test(value); }

export function isISODate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function text(value: unknown, name: string, max: number, required = false) {
  if (value == null) value = "";
  if (typeof value !== "string") throw new HttpError(422, `${name} must be text`);
  const normalized = value.trim();
  if (required && !normalized) throw new HttpError(422, `${name} is required`);
  if (normalized.length > max) throw new HttpError(422, `${name} is too long`, { max });
  return normalized;
}

function number(value: unknown, name: string, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(422, `${name} must be between ${min} and ${max}`);
  }
  return value;
}

export function validateBookingInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(422, "Invalid booking");
  const body = input as Record<string, unknown>;
  if (!bookingTypes.has(body.type as BookingType)) throw new HttpError(422, "Invalid booking type");
  if (!priorities.has(body.priority as BookingPriority)) throw new HttpError(422, "Invalid priority");
  const date = text(body.date, "Date", 10, true);
  if (!isISODate(date)) throw new HttpError(422, "Invalid date");
  const time = text(body.time, "Time", 5);
  if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(422, "Invalid time");

  const site = text(body.site, "Job site", 120);
  const pickupLocation = text(body.pickupLocation, "Pickup location", 240);
  const type = body.type as BookingType;
  if ((type === "delivery" || type === "tool-delivery") && !site) throw new HttpError(422, "Job site is required for deliveries");
  if ((type === "pickup" || type === "tool-delivery") && !pickupLocation) throw new HttpError(422, "Pickup location is required");
  if (body.bundleRequested === true && !site) throw new HttpError(422, "A job site is required to bundle a dispatch");

  const photoId = body.photoId == null || body.photoId === "" ? null : text(body.photoId, "Photo", 100, true);
  if (photoId && !isUuid(photoId)) throw new HttpError(422, "Invalid photo ID");
  return {
    type,
    priority: body.priority as BookingPriority,
    site,
    pickupLocation,
    description: text(body.description, "Description", 3000, true),
    date,
    time,
    notes: text(body.notes, "Notes", 2000),
    photoId,
    bundleRequested: body.bundleRequested === true,
  };
}

export function validateSiteInput(input: unknown): Omit<Site, "version" | "createdAt" | "updatedAt"> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(422, "Invalid site");
  const body = input as Record<string, unknown>;
  const latPresent = body.lat !== undefined && body.lat !== null && body.lat !== "";
  const lngPresent = body.lng !== undefined && body.lng !== null && body.lng !== "";
  if (latPresent !== lngPresent) throw new HttpError(422, "Latitude and longitude must be provided together");
  const site: Omit<Site, "version" | "createdAt" | "updatedAt"> = {
    name: text(body.name, "Site name", 120, true),
    min: number(body.min, "Round-trip minutes", 0, 600),
    km: number(body.km, "Round-trip kilometres", 0, 1000),
  };
  if (latPresent) {
    site.lat = number(body.lat, "Latitude", -90, 90);
    site.lng = number(body.lng, "Longitude", -180, 180);
  }
  return site;
}

export function validateStatus(value: unknown): BookingStatus {
  if (!statuses.has(value as BookingStatus)) throw new HttpError(422, "Invalid status");
  return value as BookingStatus;
}

export function validateVersion(value: unknown) {
  if (!Number.isInteger(value) || (value as number) < 1) throw new HttpError(422, "A valid booking version is required");
  return value as number;
}

export function idempotencyKey(req: Request) {
  const value = req.headers.get("idempotency-key") || "";
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(value)) throw new HttpError(400, "A valid Idempotency-Key header is required");
  return value;
}
