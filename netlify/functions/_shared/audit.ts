import type { Context } from "@netlify/functions";
import { auditStore } from "./stores";
import type { AuditEvent, AuthUser } from "./types";

function primaryRole(user: AuthUser) {
  return user.roles.includes("manager") ? "manager" : user.roles.includes("dispatcher") ? "dispatcher" : "member";
}

export async function recordAudit(
  user: AuthUser,
  action: string,
  targetType: AuditEvent["targetType"],
  targetId: string,
  context?: Context,
  details?: AuditEvent["details"],
) {
  const occurredAt = new Date().toISOString();
  const event: AuditEvent = {
    id: crypto.randomUUID(),
    occurredAt,
    actorId: user.id,
    actorEmail: user.email,
    actorRole: primaryRole(user),
    action,
    targetType,
    targetId,
    requestId: context?.requestId,
    details,
  };
  const reverseTime = String(9_999_999_999_999 - Date.parse(occurredAt)).padStart(13, "0");
  await auditStore().setJSON(`event/${reverseTime}-${event.id}`, event);
  return event;
}
