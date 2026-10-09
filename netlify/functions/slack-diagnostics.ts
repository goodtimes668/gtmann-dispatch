import { timingSafeEqual } from "node:crypto";
import type { Config } from "@netlify/functions";
import { allowMethods, handleError, HttpError, json } from "./_shared/http";
import { recentSlackTraces } from "./_shared/slack-diagnostics";

// Read-only health readout for the Slack request form. Disabled unless
// SLACK_DIAGNOSTICS_KEY is set, and then only for callers that present it.
// Reports which Slack app the bot token belongs to, what it is allowed to do,
// and the last few Slack requests this site received. Never returns a secret.

function keyMatches(given: string, expected: string) {
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function slackGet(method: string, token: string, params: Record<string, string> = {}) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const body = await response.json() as Record<string, any>;
  return { body, scopes: response.headers.get("x-oauth-scopes") || "" };
}

async function describeBotToken() {
  const token = (Netlify.env.get("DISPATCH_SLACK_BOT_TOKEN") || "").trim();
  if (!token) return { configured: false };
  try {
    const auth = await slackGet("auth.test", token);
    if (!auth.body.ok) return { configured: true, valid: false, error: String(auth.body.error || "unknown") };
    const scopes = auth.scopes.split(",").map((scope) => scope.trim()).filter(Boolean);
    let appId: string | null = null;
    let botName: string | null = null;
    if (auth.body.bot_id) {
      const bot = await slackGet("bots.info", token, { bot: String(auth.body.bot_id) });
      if (bot.body.ok) { appId = bot.body.bot?.app_id || null; botName = bot.body.bot?.name || null; }
    }
    const needed = ["chat:write", "im:write", "users:read", "users:read.email"];
    return {
      configured: true,
      valid: true,
      kind: token.split("-")[0],
      team: auth.body.team || null,
      botUser: auth.body.user || null,
      botUserId: auth.body.user_id || null,
      botId: auth.body.bot_id || null,
      botName,
      appId,
      scopes,
      missingScopes: needed.filter((scope) => !scopes.includes(scope)),
    };
  } catch (error) {
    return { configured: true, valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default async (req: Request) => {
  try {
    allowMethods(req, ["GET"]);
    const expected = (Netlify.env.get("SLACK_DIAGNOSTICS_KEY") || "").trim();
    const given = new URL(req.url).searchParams.get("key") || "";
    // Answer exactly like a missing page when disabled or the key is wrong.
    if (expected.length < 24 || !keyMatches(given, expected)) throw new HttpError(404, "Not found");

    const [botToken, traces] = await Promise.all([describeBotToken(), recentSlackTraces()]);
    return json({
      checkedAt: new Date().toISOString(),
      signingSecret: { configured: Boolean((Netlify.env.get("DISPATCH_SLACK_SIGNING_SECRET") || "").trim()), length: (Netlify.env.get("DISPATCH_SLACK_SIGNING_SECRET") || "").trim().length },
      botToken,
      notifyTargets: { brentSlackId: Boolean(Netlify.env.get("BRENT_SLACK_ID")), managerChannel: Boolean(Netlify.env.get("SLACK_MANAGER_CHANNEL_ID")) },
      recentRequests: traces,
    });
  } catch (error) {
    return handleError(error);
  }
};

export const config: Config = { path: "/api/slack/diagnostics" };
