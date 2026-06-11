import { db } from "./db.js";

export interface AuditEntry {
  id: string;
  userId: number;
  userName: string;
  timestamp: number;
  actionType: "config" | "blacklist" | "filters" | "notes" | "swearwords" | "moderation";
  description: string;
  previousState: any;
  undone?: boolean;
}

export async function logAuditAction(
  chatId: number | string,
  userId: number,
  userName: string,
  actionType: AuditEntry["actionType"],
  description: string,
  previousState: any
) {
  const entry: AuditEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    userId,
    userName,
    timestamp: Date.now(),
    actionType,
    description,
    previousState,
  };

  const key = `chat:${chatId}:audit_log`;
  await db.lpush(key, JSON.stringify(entry));
}
