export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...securityHeaders, ...headers },
  });
}

export async function readJson(req: Request, maxBytes = 64 * 1024) {
  const type = req.headers.get("content-type") || "";
  if (!type.includes("application/json")) throw new HttpError(415, "Expected application/json");
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new HttpError(413, "Request body is too large");
  let source: string;
  try { source = await req.text(); } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (new TextEncoder().encode(source).byteLength > maxBytes) throw new HttpError(413, "Request body is too large");
  try { return JSON.parse(source); } catch { throw new HttpError(400, "Invalid JSON body"); }
}

export function handleError(error: unknown, requestId = crypto.randomUUID()) {
  if (error instanceof HttpError) return json({ error: error.message, details: error.details }, error.status);
  console.error(JSON.stringify({
    level: "error",
    service: "gtmann-dispatch",
    event: "function_failure",
    requestId,
    occurredAt: new Date().toISOString(),
    errorName: error instanceof Error ? error.name : "UnknownError",
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }));
  return json({ error: "Internal server error", requestId }, 500, { "X-Request-ID": requestId });
}

export function allowMethods(req: Request, allowed: string[]) {
  if (!allowed.includes(req.method)) {
    throw new HttpError(405, "Method not allowed", { allowed });
  }
}
