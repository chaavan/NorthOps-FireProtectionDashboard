const RETRYABLE_DB_PATTERNS = [
  "can't reach database server",
  "connection terminated",
  "connection timed out",
  "econnreset",
  "etimedout",
  "server closed the connection",
  "too many connections",
  "p1001",
];

export function isRetryableDbError(error: unknown) {
  const message = String((error as Error)?.message ?? error ?? "").toLowerCase();
  return RETRYABLE_DB_PATTERNS.some((pattern) => message.includes(pattern));
}

export function toUserFacingDbError(error: unknown, fallback = "Something went wrong.") {
  const message = String((error as Error)?.message ?? error ?? fallback);
  const lower = message.toLowerCase();

  if (isRetryableDbError(error)) {
    return "Database is temporarily unavailable. Wait a few seconds and try again.";
  }
  if (lower.includes("record to find does not exist") || lower.includes("not found")) {
    return "Estimate not found.";
  }

  return message.length > 240 ? fallback : message;
}

export async function withDbRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
  delayMs = 750,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableDbError(error) || attempt === attempts) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError;
}
