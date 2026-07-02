/** 24h snooze blocks auto-popup only; sidebar reopen ignores snooze. */
const SNOOZE_PREFIX = "tfp-survey-snoozed-until-";
const LEGACY_SNOOZE_PREFIX = "tfp-survey-snoozed-";
const SNOOZE_MS = 24 * 60 * 60 * 1000;

function snoozeKey(surveyId: string): string {
  return `${SNOOZE_PREFIX}${surveyId}`;
}

export function setSnooze(surveyId: string, durationMs = SNOOZE_MS): void {
  if (typeof window === "undefined") return;
  const until = new Date(Date.now() + durationMs).toISOString();
  sessionStorage.setItem(snoozeKey(surveyId), until);
  sessionStorage.removeItem(`${LEGACY_SNOOZE_PREFIX}${surveyId}`);
}

export function isSnoozed(surveyId: string): boolean {
  if (typeof window === "undefined") return false;

  const legacyKey = `${LEGACY_SNOOZE_PREFIX}${surveyId}`;
  if (sessionStorage.getItem(legacyKey) === "true") {
    return true;
  }

  const untilRaw = sessionStorage.getItem(snoozeKey(surveyId));
  if (!untilRaw) return false;

  const until = Date.parse(untilRaw);
  if (Number.isNaN(until) || Date.now() >= until) {
    sessionStorage.removeItem(snoozeKey(surveyId));
    return false;
  }

  return true;
}

export function clearSnoozeForSurvey(surveyId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(snoozeKey(surveyId));
  sessionStorage.removeItem(`${LEGACY_SNOOZE_PREFIX}${surveyId}`);
}

export function clearAllSnoozes(): void {
  if (typeof window === "undefined") return;
  const keysToRemove: string[] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (
      key &&
      (key.startsWith(SNOOZE_PREFIX) || key.startsWith(LEGACY_SNOOZE_PREFIX))
    ) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => sessionStorage.removeItem(key));
}

/** Remove orphaned survey portal nodes left in document.body after HMR/navigation. */
export function removeSurveyPopupDom(): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll("[data-tfp-survey-popup]").forEach((el) => el.remove());
}
