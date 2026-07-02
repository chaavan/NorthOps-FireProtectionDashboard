"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import type {
  SurveyAnswers,
  SurveyDraftProgress,
  SurveyQuestion,
} from "@/lib/survey/surveyQuestions";
import { parseSurveyQuestions } from "@/lib/survey/surveyQuestions";
import { isSnoozed, setSnooze } from "@/lib/survey/surveySnooze";

export type ActiveSurveyPayload = {
  id: string;
  version: number;
  title: string;
  tagline: string;
  prefaceHeading: string;
  prefaceMessage: string;
  questions: SurveyQuestion[];
};

export type SurveyDraftPayload = {
  answers: SurveyAnswers;
  progress: SurveyDraftProgress | null;
};

type ActiveApiResponse = {
  shouldAutoOpen: boolean;
  canResume: boolean;
  survey?: {
    id: string;
    version: number;
    title: string;
    tagline?: string;
    prefaceHeading?: string;
    prefaceMessage?: string;
    questions: unknown;
  };
  draft?: SurveyDraftPayload | null;
};

type SurveyOpenMode = "auto" | "manual" | null;

type SurveyContextValue = {
  canResume: boolean;
  surveyOpen: boolean;
  openMode: SurveyOpenMode;
  pendingSurvey: ActiveSurveyPayload | null;
  draft: SurveyDraftPayload | null;
  openSurvey: () => void;
  closeSurvey: (options?: { snooze?: boolean }) => void;
  refreshActive: () => Promise<void>;
  onSurveyCompleted: () => void;
};

const SurveyContext = createContext<SurveyContextValue | null>(null);

function buildSurveyPayload(
  survey: NonNullable<ActiveApiResponse["survey"]>,
): ActiveSurveyPayload | null {
  const questions = parseSurveyQuestions(survey.questions);
  if (questions.length === 0) return null;
  return {
    id: survey.id,
    version: survey.version,
    title: survey.title,
    tagline: survey.tagline || "",
    prefaceHeading: survey.prefaceHeading || "",
    prefaceMessage: survey.prefaceMessage || "",
    questions,
  };
}

export function SurveyProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const isDeveloper = !!(session?.user as { isDeveloper?: boolean } | undefined)
    ?.isDeveloper;

  const [canResume, setCanResume] = useState(false);
  const [shouldAutoOpen, setShouldAutoOpen] = useState(false);
  const [pendingSurvey, setPendingSurvey] = useState<ActiveSurveyPayload | null>(null);
  const [draft, setDraft] = useState<SurveyDraftPayload | null>(null);
  const [surveyOpen, setSurveyOpen] = useState(false);
  const [openMode, setOpenMode] = useState<SurveyOpenMode>(null);
  const [autoOpenAttempted, setAutoOpenAttempted] = useState(false);

  const refreshActive = useCallback(async () => {
    if (status !== "authenticated" || !session?.user || isDeveloper) {
      setCanResume(false);
      setShouldAutoOpen(false);
      setPendingSurvey(null);
      setDraft(null);
      return;
    }

    try {
      const response = await fetch("/api/survey/active", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as ActiveApiResponse;
      const survey = data.survey ? buildSurveyPayload(data.survey) : null;

      setCanResume(!!data.canResume && !!survey);
      setShouldAutoOpen(!!data.shouldAutoOpen && !!survey);
      setPendingSurvey(survey);
      setDraft(
        data.draft
          ? {
              answers: data.draft.answers || {},
              progress: data.draft.progress ?? null,
            }
          : null,
      );

      if (!survey) {
        setSurveyOpen(false);
        setOpenMode(null);
      }
    } catch {
      // Survey must not block dashboard usage.
    }
  }, [isDeveloper, session?.user, status]);

  useEffect(() => {
    void refreshActive();
  }, [refreshActive]);

  useEffect(() => {
    if (
      autoOpenAttempted ||
      !shouldAutoOpen ||
      !pendingSurvey ||
      surveyOpen ||
      isDeveloper ||
      status !== "authenticated"
    ) {
      return;
    }

    if (isSnoozed(pendingSurvey.id)) {
      setAutoOpenAttempted(true);
      return;
    }

    setAutoOpenAttempted(true);
    setOpenMode("auto");
    setSurveyOpen(true);
  }, [
    autoOpenAttempted,
    isDeveloper,
    pendingSurvey,
    shouldAutoOpen,
    status,
    surveyOpen,
  ]);

  const openSurvey = useCallback(() => {
    if (!pendingSurvey) return;
    setOpenMode("manual");
    setSurveyOpen(true);
  }, [pendingSurvey]);

  const closeSurvey = useCallback(
    (options?: { snooze?: boolean }) => {
      if (options?.snooze !== false && pendingSurvey?.id) {
        setSnooze(pendingSurvey.id);
      }
      setSurveyOpen(false);
      setOpenMode(null);
    },
    [pendingSurvey?.id],
  );

  const onSurveyCompleted = useCallback(() => {
    setCanResume(false);
    setShouldAutoOpen(false);
    setPendingSurvey(null);
    setDraft(null);
    setSurveyOpen(false);
    setOpenMode(null);
    setAutoOpenAttempted(true);
  }, []);

  const value = useMemo(
    () => ({
      canResume,
      surveyOpen,
      openMode,
      pendingSurvey,
      draft,
      openSurvey,
      closeSurvey,
      refreshActive,
      onSurveyCompleted,
    }),
    [
      canResume,
      surveyOpen,
      openMode,
      pendingSurvey,
      draft,
      openSurvey,
      closeSurvey,
      refreshActive,
      onSurveyCompleted,
    ],
  );

  return <SurveyContext.Provider value={value}>{children}</SurveyContext.Provider>;
}

export function useSurvey() {
  const context = useContext(SurveyContext);
  if (!context) {
    throw new Error("useSurvey must be used within SurveyProvider");
  }
  return context;
}

export function countAnsweredQuestions(
  questions: SurveyQuestion[],
  answers: SurveyAnswers,
): number {
  return questions.filter((question) => {
    const value = answers[question.id];
    if (value === undefined || value === null) return false;
    if (question.type === "short") {
      return typeof value === "string" && value.trim().length > 0;
    }
    if (typeof value === "string") return value.length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") {
      const selected = Array.isArray(value.selected)
        ? value.selected
        : value.selected
          ? [value.selected]
          : [];
      return selected.length > 0;
    }
    return false;
  }).length;
}
