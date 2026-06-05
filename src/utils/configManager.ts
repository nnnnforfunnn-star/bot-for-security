import { db } from "./db.js";

export interface GroupConfig {
  captchaEnabled: boolean;
  nightModeEnabled: boolean;
  quarantineEnabled: boolean;
  karmaEnabled: boolean;
  antiSwearEnabled: boolean;
  muteDurationMinutes: number;
  warnLimit: number;
  warnAction: "mute" | "ban" | "kick";
  antiChannel: boolean;
  
  // Locks Module
  locks: {
    links: boolean;
    forwards: boolean;
    bots: boolean;
    media: boolean;
    stickers: boolean;
    gifs: boolean;
    voices: boolean;
    arabic: boolean;
    porn: boolean;
  };
  
  // Antiflood
  antiflood: {
    enabled: boolean;
    messages: number;
    seconds: number;
    action: "mute" | "ban" | "kick" | "delete";
  };
  
  // Welcome & Goodbye
  welcome: {
    enabled: boolean;
    text: string;
  };
  goodbye: {
    enabled: boolean;
    text: string;
  };
  
  // Rules
  rulesText: string;
}

export const DEFAULT_CONFIG: GroupConfig = {
  captchaEnabled: true,
  nightModeEnabled: false,
  quarantineEnabled: true,
  karmaEnabled: true,
  antiSwearEnabled: true,
  muteDurationMinutes: 120,
  warnLimit: 3,
  warnAction: "mute",
  antiChannel: false,
  
  locks: {
    links: false,
    forwards: false,
    bots: true,
    media: false,
    stickers: false,
    gifs: false,
    voices: false,
    arabic: true,
    porn: true
  },
  
  antiflood: {
    enabled: false,
    messages: 5,
    seconds: 5,
    action: "mute"
  },
  
  welcome: {
    enabled: true,
    text: "👋 Кош келдиңиз, {name}!"
  },
  goodbye: {
    enabled: false,
    text: "Кош болуңуз, {name}!"
  },
  
  rulesText: "Тайпанын эрежелери азырынча жазыла элек. Админдер /setrules буйругу менен кошо алышат."
};

export async function getGroupConfig(chatId: number): Promise<GroupConfig> {
  const conf = await db.get<Partial<GroupConfig>>(`chat:${chatId}:config`);
  // Deep merge for nested objects like locks
  return {
    ...DEFAULT_CONFIG,
    ...(conf || {}),
    locks: { ...DEFAULT_CONFIG.locks, ...(conf?.locks || {}) },
    antiflood: { ...DEFAULT_CONFIG.antiflood, ...(conf?.antiflood || {}) },
    welcome: { ...DEFAULT_CONFIG.welcome, ...(conf?.welcome || {}) },
    goodbye: { ...DEFAULT_CONFIG.goodbye, ...(conf?.goodbye || {}) }
  };
}

export async function updateGroupConfig(chatId: number, newConfig: Partial<GroupConfig>): Promise<GroupConfig> {
  const current = await getGroupConfig(chatId);
  const updated = { ...current, ...newConfig };
  await db.set(`chat:${chatId}:config`, updated);
  return updated;
}
