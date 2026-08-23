import { getUser, verifyRequestOrigin } from "@netlify/identity";
import { HttpError } from "./http";
import type { AuthUser, DispatchRole } from "./types";

const knownRoles = new Set<DispatchRole>(["pending", "member", "dispatcher", "manager"]);

export async function requireUser(required: DispatchRole[] = [], options: { allowPending?: boolean } = {}): Promise<AuthUser> {
  const identityUser = await getUser();
  if (!identityUser?.id) throw new HttpError(401, "Sign in required");

  const roles = (identityUser.roles || []).filter((role): role is DispatchRole => knownRoles.has(role as DispatchRole));
  if (!roles.length) roles.push("member");
  if (roles.includes("manager") && !roles.includes("dispatcher")) roles.push("dispatcher");

  if (roles.includes("pending") && !options.allowPending) {
    throw new HttpError(403, "Your account is waiting for manager approval");
  }

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

export function requireSameOrigin(req: Request) {
  try { verifyRequestOrigin(req); }
  catch { throw new HttpError(403, "Cross-origin request rejected"); }
}
