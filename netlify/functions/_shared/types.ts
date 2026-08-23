export type DispatchRole = "pending" | "member" | "dispatcher" | "manager";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  roles: DispatchRole[];
};

export type Site = {
  name: string;
  address?: string;
  min: number;
  km: number;
  lat?: number;
  lng?: number;
  routeSource?: "mapbox" | "estimated" | "manual";
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type BookingStatus = "pending" | "approved" | "declined" | "in-progress" | "completed";
export type BookingType = "delivery" | "pickup" | "tool-delivery" | "misc";
export type BookingPriority = "urgent" | "normal" | "scheduled";

export type Booking = {
  id: string;
  version: number;
  status: BookingStatus;
  type: BookingType;
  priority: BookingPriority;
  requester: string;
  requesterEmail: string;
  requesterId: string;
  site: string;
  pickupLocation: string;
  description: string;
  date: string;
  time: string;
  notes: string;
  supplier: string;
  poNumber: string;
  siteContact: string;
  loadSize: "small" | "medium" | "large" | "flat-deck-truck" | "bin-truck" | "oversize";
  readyConfirmed: boolean;
  brentNotes: string;
  assignedTo: string;
  vehicle: string;
  durationMinutes: number;
  photoId: string | null;
  completionPhotoId?: string | null;
  estCost: number;
  estMinutes: number;
  estKm: number;
  bundleRequested: boolean;
  bundleStatus: "none" | "queued" | "matched";
  bundleWithId: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  completedAt?: string;
  actualMinutes?: number;
  actualKm?: number;
  actualCost?: number;
  completionNotes?: string;
  receivedBy?: string;
};

export type AuditEvent = {
  id: string;
  occurredAt: string;
  actorId: string;
  actorEmail: string;
  actorRole: DispatchRole;
  action: string;
  targetType: "booking" | "site" | "user" | "photo" | "backup" | "system";
  targetId: string;
  requestId?: string;
  details?: Record<string, string | number | boolean | null>;
};

export type BackupSnapshot = {
  schemaVersion: 1 | 2;
  id: string;
  createdAt: string;
  createdBy: "scheduled" | "manager";
  bookings: Booking[];
  sites: Site[];
  audit: AuditEvent[];
  photoIds: string[];
};
