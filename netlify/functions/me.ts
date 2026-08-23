import type { Config } from "@netlify/functions";
import { requireUser } from "./_shared/auth";
import { handleError, json } from "./_shared/http";

export default async () => {
  try {
    return json(await requireUser([], { allowPending: true }));
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/me" };
