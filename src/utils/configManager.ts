import { db } from "./db.js";

export interface GroupConfig {
  captchaEnabled: boolean;
  captchaMode: "button" | "math" | "text" | "emoji" | "button_timer";
  captchaTime: number;
  captchaKick: boolean;
  cleanWelcome: boolean;
  nightModeEnabled: boolean;
  nightModeStart: number;
  nightModeEnd: number;
  quarantineEnabled: boolean;
  karmaEnabled: boolean;
  antiSwearEnabled: boolean;
  muteDurationMinutes: number;
  warnLimit: number;
  warnAction: "mute" | "ban" | "kick";
  antiChannel: boolean;
  antiArabicName: boolean;
  silentMode: boolean;
  logChannelId: string;
  lockdownMode: boolean;
  disableFilters: boolean;
  disabledCommands?: Record<string, boolean>;
  linkWhitelist?: string[];
  
  // Advanced Granular Actions
  lockdownAction?: "delete" | "mute" | "warn" | "kick" | "ban";
  swearAction?: "delete" | "warn" | "mute" | "kick" | "ban";
  arabicAction?: "delete" | "warn" | "mute" | "kick" | "ban";
  channelAction?: "delete" | "warn" | "mute" | "kick" | "ban";
  nightModeAction?: "delete" | "mute" | "warn" | "kick" | "ban";
  warnExpireDays?: number;
  floodMuteDuration?: number;
  locksAction?: "delete" | "warn" | "mute";

  // Locks Module
  locks: {
    text: boolean;
    links: boolean;
    forwards: boolean;
    bots: boolean;
    photo: boolean;
    video: boolean;
    audio: boolean;
    document: boolean;
    videonote: boolean;
    media: boolean;
    stickers: boolean;
    gifs: boolean;
    voices: boolean;
    arabic: boolean;
    commands: boolean;
    games: boolean;
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

  // Advanced Onboarding settings
  welcomeAutoDelete?: number;
  goodbyeAutoDelete?: number;
  newcomerRestrict?: boolean;
  newcomerRestrictDuration?: number;
  rulesAgreement?: boolean;
  welcomePin?: boolean;
  joinFilterNoUsername?: boolean;
  joinFilterNoPhoto?: boolean;
  joinFilterSpamScanner?: boolean;
  joinFilterSpamKeywords?: string[];
  joinFilterSpamAction?: "kick" | "ban";
  
  // Rules
  rulesText: string;
  
  // Custom command configs
  customCommands?: Record<string, {
    alias?: string;
    replyText?: string;
    action?: "ban" | "mute" | "kick" | "warn" | "unban" | "unmute" | "unwarn" | "del" | "none";
    muteDuration?: number;
    warnCount?: number;
    autoDelete?: boolean;
  }>;
}

export const DEFAULT_CONFIG: GroupConfig = {
  captchaEnabled: false,
  captchaMode: "button",
  captchaTime: 120,
  captchaKick: false,
  cleanWelcome: false,
  nightModeEnabled: false,
  nightModeStart: 0,
  nightModeEnd: 7,
  quarantineEnabled: true,
  karmaEnabled: true,
  antiSwearEnabled: true,
  muteDurationMinutes: 120,
  warnLimit: 3,
  warnAction: "mute",
  antiChannel: false,
  antiArabicName: false,
  silentMode: false,
  logChannelId: "",
  lockdownMode: false,
  disableFilters: false,
  disabledCommands: {},
  linkWhitelist: [],
  
  lockdownAction: "delete",
  swearAction: "warn",
  arabicAction: "ban",
  channelAction: "ban",
  nightModeAction: "delete",
  warnExpireDays: 0,
  floodMuteDuration: 120,
  locksAction: "delete",
  
  locks: {
    text: false,
    links: false,
    forwards: false,
    bots: true,
    photo: false,
    video: false,
    audio: false,
    document: false,
    videonote: false,
    media: false,
    stickers: false,
    gifs: false,
    voices: false,
    arabic: true,
    commands: false,
    games: false,
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
  welcomeAutoDelete: 0,
  goodbyeAutoDelete: 0,
  newcomerRestrict: false,
  newcomerRestrictDuration: 60,
  rulesAgreement: false,
  welcomePin: false,
  joinFilterNoUsername: false,
  joinFilterNoPhoto: false,
  joinFilterSpamScanner: false,
  joinFilterSpamKeywords: ["HR-менеджер", "Набираем активных", "Заработок в интернете", "investing", "крипта", "пишите в лс"],
  joinFilterSpamAction: "ban",
  
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
