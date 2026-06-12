import { bot } from "../src/bot.js";
import { runActivityCheck } from "../src/utils/activityScheduler.js";

let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // Verify this request is triggered by Vercel Cron
  const isVercelCron = req.headers["x-vercel-cron"] === "1";
  const hasCronSecret = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;

  if (!isVercelCron && !hasCronSecret) {
    return res.status(401).json({ error: "Unauthorized: Access restricted to Vercel Cron scheduler" });
  }

  try {
    if (!isBotInitialized) {
      await bot.init();
      isBotInitialized = true;
    }

    await runActivityCheck();
    return res.status(200).json({ success: true, message: "Activity scheduler run completed successfully" });
  } catch (error) {
    console.error("Cron Job Error:", error);
    return res.status(500).json({ error: "Internal Server Error during cron job execution" });
  }
}
