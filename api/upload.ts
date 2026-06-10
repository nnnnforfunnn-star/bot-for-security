import { validateWebAppData, getUserFromInitData } from "../src/utils/telegramAuth.js";
import { isUserSeniorAdminInChat } from "../src/utils/telegram.js";
import { bot } from "../src/bot.js";

let isBotInitialized = false;

export default async function handler(req: any, res: any) {
  // CORS setup
  res.setHeader("Access-Control-Allow-Credentials", true);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("tma ")) {
      return res.status(401).json({ error: "Unauthorized: Missing Telegram Web App initData" });
    }

    const initData = authHeader.split(" ")[1];
    
    if (!validateWebAppData(initData)) {
      return res.status(401).json({ error: "Unauthorized: Invalid Telegram Web App data" });
    }

    const user = getUserFromInitData(initData);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized: Cannot parse user" });
    }

    const chatId = parseInt(req.query.chatId as string, 10);
    if (isNaN(chatId)) {
      return res.status(400).json({ error: "Bad Request: Missing or invalid chatId" });
    }

    if (!isBotInitialized) {
      await bot.init();
      isBotInitialized = true;
    }

    const isAdmin = await isUserSeniorAdminInChat(bot.api, chatId, user.id);
    if (!isAdmin) {
      return res.status(403).json({ error: "Forbidden: You are not a Senior Administrator in this chat" });
    }

    const { file, name, mimeType } = req.body;
    if (!file) {
      return res.status(400).json({ error: "Bad Request: Missing file content" });
    }

    // Извлекаем чистый base64
    const base64Data = file.includes(";base64,") ? file.split(";base64,").pop() : file;
    const buffer = Buffer.from(base64Data, "base64");
    
    // Создаем Blob из буфера
    const blob = new Blob([buffer], { type: mimeType || "image/jpeg" });
    
    const formData = new FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", blob, name || "image.jpg");

    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Catbox responded with status ${response.status}`);
    }

    const fileUrl = await response.text();
    if (!fileUrl || !fileUrl.startsWith("http")) {
      throw new Error(`Invalid Catbox response: ${fileUrl}`);
    }

    return res.status(200).json({ success: true, url: fileUrl.trim() });
  } catch (error: any) {
    console.error("Upload API Error:", error);
    return res.status(500).json({ error: error.message || "Internal Server Error" });
  }
}
