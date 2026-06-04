import { BotError, GrammyError, HttpError } from "grammy";
import { logger } from "../utils/logger.js";

/**
 * Глобальный обработчик ошибок для grammY.
 * Предотвращает падение процесса Node.js и детально логирует произошедшее.
 */
export function globalErrorHandler(err: BotError): void {
  const ctx = err.ctx;
  const error = err.error;

  const contextDetails = {
    updateId: ctx.update.update_id,
    chatId: ctx.chat?.id,
    userId: ctx.from?.id,
    username: ctx.from?.username,
  };

  if (error instanceof GrammyError) {
    logger.error(
      `Ошибка выполнения запроса к API Telegram в апдейте ${ctx.update.update_id}: ${error.description}`,
      error,
      contextDetails
    );
  } else if (error instanceof HttpError) {
    logger.error(
      `Сетевая ошибка при связи с API Telegram в апдейте ${ctx.update.update_id}`,
      error,
      contextDetails
    );
  } else {
    logger.error(
      `Неизвестная ошибка во время обработки апдейта ${ctx.update.update_id}`,
      error,
      contextDetails
    );
  }
}
