export function toPublicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const raw = error.message.trim();
  if (!raw) {
    return fallback;
  }

  if (raw.includes("Unable to fit integer value")) {
    return "One or more line quantities are too large to save. Review flagged rows and correct quantities before creating the job.";
  }

  if (raw.includes("Invalid `prisma.") || raw.includes("ConnectorError")) {
    return fallback;
  }

  const withoutPaths = raw
    .replace(/\/?Users\/[^\s\n]+/g, "")
    .replace(/\n+/g, " ")
    .trim();

  if (!withoutPaths || withoutPaths.length > 300) {
    return fallback;
  }

  return withoutPaths;
}
