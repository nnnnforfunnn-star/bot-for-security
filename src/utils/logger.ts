export const logger = {
  info: (message: string, context?: Record<string, unknown>) => {
    console.log(
      JSON.stringify({
        level: "info",
        timestamp: new Date().toISOString(),
        message,
        ...context,
      })
    );
  },
  warn: (message: string, context?: Record<string, unknown>) => {
    console.warn(
      JSON.stringify({
        level: "warn",
        timestamp: new Date().toISOString(),
        message,
        ...context,
      })
    );
  },
  error: (message: string, error?: unknown, context?: Record<string, unknown>) => {
    const errorDetails = error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { rawError: error };

    console.error(
      JSON.stringify({
        level: "error",
        timestamp: new Date().toISOString(),
        message,
        error: errorDetails,
        ...context,
      })
    );
  },
};
