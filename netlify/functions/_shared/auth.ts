import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { HttpError } from "./http";
import type { AuthUser, Booking, DispatchRole } from "./types";

const knownRoles = new Set<DispatchRole>(["member", "dispatcher", "manager"]);

export async function requireUser(required: DispatchRole[] = []): Promise<AuthUser> {
  const identityUser = await getUser();
  if (!identityUser?.id) throw new HttpError(401, "Sign in required");

  const roles = (identityUser.roles || []).filter((role): role is DispatchRole => knownRoles.has(role as DispatchRole));
  if (!roles.length) roles.push("member");
  if (roles.includes("manager") && !roles.includes("dispatcher")) roles.push("dispatcher");

  if (required.length && !required.some((role) => roles.includes(role))) {
    throw new HttpError(403, "You do not have permission to perform this action");
  }

  return {
    id: identityUser.id,
    email: identityUser.email || "",
    name: identityUser.name || identityUser.email?.split("@")[0] || "Team member",
    roles,
  };
}

export function canDispatch(user: AuthUser) {
  return user.roles.includes("dispatcher") || user.roles.includes("manager");
}

// A request made from Slack before its requester had a Dispatch account is held
// under the Slack identity ("slack:U…"). Sign-in requires a confirmed email, so a
// matching email is enough for that person to claim their own request.
export function ownsBooking(booking: Pick<Booking, "requesterId" | "requesterEmail">, user: Pick<AuthUser, "id" | "email">) {
  if (booking.requesterId === user.id) return true;
  return booking.requesterId.startsWith("slack:")
    && Boolean(user.email)
    && (booking.requesterEmail || "").toLowerCase() === user.email.toLowerCase();
}

export function requireSameOrigin(req: Request) {
  try { verifyRequestOrigin(req); }
  catch { throw new HttpError(403, "Cross-origin request rejected"); }
}
