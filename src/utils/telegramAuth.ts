import * as crypto from "crypto";
import { config } from "../config.js";

/**
 * Validates the initData received from Telegram Web App.
 * @param initData The raw initData string.
 * @returns true if valid, false otherwise.
 */
export function validateWebAppData(initData: string): boolean {
  if (process.env.NODE_ENV === "development") return true;
  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get("hash");
    if (!hash) return false;

    urlParams.delete("hash");
    
    // Sort parameters alphabetically
    const params = Array.from(urlParams.entries());
    params.sort((a, b) => a[0].localeCompare(b[0]));
    
    const dataCheckString = params.map(([key, value]) => `${key}=${value}`).join("\n");
    
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(config.BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    
    return calculatedHash === hash;
  } catch (e) {
    return false;
  }
}

/**
 * Parses user information from initData
 */
export function getUserFromInitData(initData: string): { id: number; first_name: string; username?: string } | null {
  try {
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get("user");
    if (!userStr) return null;
    return JSON.parse(decodeURIComponent(userStr));
  } catch (e) {
    return null;
  }
}
