import { bot } from "../src/bot.js";
import { config } from "../src/config.js";
import { db } from "../src/utils/db.js";
import { logger } from "../src/utils/logger.js";

let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method !== "GET") {
    res.setHeader("Allow", ["GET"]);
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const reports: Record<string, any> = {
    timestamp: new Date().toISOString(),
    status: "healthy"
  };

  let hasError = false;

  // 1. Check Redis Connection
  try {
    const start = Date.now();
    await db.set("health:ping", "pong", 10);
    const val = await db.get("health:ping");
    reports.redis = {
      status: val === "pong" ? "connected" : "invalid_response",
      latencyMs: Date.now() - start
    };
    if (val !== "pong") hasError = true;
  } catch (err: any) {
    reports.redis = { status: "disconnected", error: err.message || err };
    hasError = true;
  }

  // 2. Check Telegram Bot API & Webhook
  try {
    if (!isBotInitialized) {
      await bot.init();
      isBotInitialized = true;
    }

    const start = Date.now();
    const botMe = await bot.api.getMe();
    reports.telegram = {
      status: "connected",
      botName: botMe.username,
      latencyMs: Date.now() - start
    };

    const webhookInfo = await bot.api.getWebhookInfo();
    const expectedUrl = `${config.APP_URL}/api/webhook`;
    reports.webhook = {
      currentUrl: webhookInfo.url,
      expectedUrl: expectedUrl,
      pendingUpdates: webhookInfo.pending_update_count,
      status: webhookInfo.url === expectedUrl ? "ok" : "mismatched"
    };

    // Self-healing: if webhook URL is mismatched or deleted, restore it automatically!
    if (webhookInfo.url !== expectedUrl) {
      logger.info(`Self-healing: Webhook URL mismatch detected (${webhookInfo.url || "none"}). Re-setting to ${expectedUrl}...`);
      const success = await bot.api.setWebhook(expectedUrl, {
        secret_token: config.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query", "chat_member"]
      });
      reports.webhook.selfHealing = success ? "restored" : "failed";
      if (!success) {
        hasError = true;
      }
    }
  } catch (err: any) {
    reports.telegram = { status: "error", error: err.message || err };
    hasError = true;
  }

  if (hasError) {
    reports.status = "degraded";
    return res.status(500).json(reports);
  }

  return res.status(200).json(reports);
}
