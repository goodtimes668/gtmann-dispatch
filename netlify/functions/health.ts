import type { Config, Context } from "@netlify/functions";
import { json } from "./_shared/http";

export default async (_req: Request, context: Context) => json({
  status: "ok",
  service: "gtmann-dispatch",
  version: "3.1.0",
  deployed: Boolean(context.deploy?.published),
  checkedAt: new Date().toISOString(),
});

export const config: Config = { path: "/api/health" };
