import { db } from "./db.js";

export interface GroupConfig {
  captchaEnabled: boolean;
  nightModeEnabled: boolean;
  quarantineEnabled: boolean;
  karmaEnabled: boolean;
  antiSwearEnabled: boolean;
  muteDurationMinutes: number;
  warnLimit: number;
  welcomeMessage: string;
}

export const DEFAULT_CONFIG: GroupConfig = {
  captchaEnabled: true,
  nightModeEnabled: false,
  quarantineEnabled: true,
  karmaEnabled: true,
  antiSwearEnabled: true,
  muteDurationMinutes: 120, // 2 часа по умолчанию
  warnLimit: 3, // 3 страйка до бана
  welcomeMessage: "👋 Кош келдиңиз, {name}!"
};

export async function getGroupConfig(chatId: number): Promise<GroupConfig> {
  const conf = await db.get<GroupConfig>(`chat:${chatId}:config`);
  return { ...DEFAULT_CONFIG, ...(conf || {}) };
}

export async function updateGroupConfig(chatId: number, newConfig: Partial<GroupConfig>): Promise<GroupConfig> {
  const current = await getGroupConfig(chatId);
  const updated = { ...current, ...newConfig };
  await db.set(`chat:${chatId}:config`, updated);
  return updated;
}
