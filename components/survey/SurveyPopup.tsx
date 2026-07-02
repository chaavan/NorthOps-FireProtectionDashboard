"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  SurveyAnswerValue,
  SurveyAnswers,
  SurveyDraftProgress,
  SurveyQuestion,
} from "@/lib/survey/surveyQuestions";
import {
  SURVEY_PREFACE_HEADING,
  SURVEY_PREFACE_MESSAGE,
  SURVEY_TAGLINE,
  formatSurveyTagline,
} from "@/lib/survey/surveyQuestions";
import { useSurvey } from "@/lib/survey/SurveyContext";
import {
  clearSnoozeForSurvey,
  removeSurveyPopupDom,
} from "@/lib/survey/surveySnooze";

function getSelected(value: SurveyAnswerValue | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value;
  return Array.isArray(value.selected) ? value.selected : value.selected ? [value.selected] : [];
}

function getOther(value: SurveyAnswerValue | undefined): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return value.other || "";
}

function hasMeaningfulDraft(
  answers: SurveyAnswers,
  progress: SurveyDraftProgress,
): boolean {
  const hasAnswers = Object.values(answers).some((value) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    return getSelected(value).length > 0;
  });
  return hasAnswers || progress.currentIndex > 0 || !progress.showPreface;
}

export default function SurveyPopup() {
  const {
    surveyOpen,
    pendingSurvey,
    draft,
    closeSurvey,
    refreshActive,
    onSurveyCompleted,
  } = useSurvey();

  const [mounted, setMounted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<SurveyAnswers>({});
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [showPreface, setShowPreface] = useState(true);
  const hydratedSurveyIdRef = useRef<string | null>(null);

  const survey = pendingSurvey;

  const saveDraft = useCallback(
    async (progress: SurveyDraftProgress) => {
      if (!survey) return;
      const payload = {
        surveyId: survey.id,
        answers,
        progress,
      };
      if (!hasMeaningfulDraft(answers, progress)) return;

      setIsSavingDraft(true);
      try {
        await fetch("/api/survey/draft", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await refreshActive();
      } catch {
        // Draft save failure should not block navigation.
      } finally {
        setIsSavingDraft(false);
      }
    },
    [answers, refreshActive, survey],
  );

  const dismissSurvey = useCallback(
    (snooze = true) => {
      const progress: SurveyDraftProgress = {
        currentIndex,
        showPreface,
      };
      if (hasMeaningfulDraft(answers, progress)) {
        void saveDraft(progress);
      }
      closeSurvey({ snooze });
      setError(null);
      setIsSubmitting(false);
      setIsComplete(false);
    },
    [answers, closeSurvey, currentIndex, saveDraft, showPreface],
  );

  useEffect(() => {
    setMounted(true);
    return () => {
      setMounted(false);
      removeSurveyPopupDom();
    };
  }, []);

  useEffect(() => {
    if (!surveyOpen || !survey) {
      hydratedSurveyIdRef.current = null;
      return;
    }

    if (hydratedSurveyIdRef.current === survey.id) return;
    hydratedSurveyIdRef.current = survey.id;

    const progress = draft?.progress;
    setAnswers(draft?.answers || {});
    setShowPreface(progress?.showPreface ?? true);
    setCurrentIndex(progress?.currentIndex ?? 0);
    setError(null);
    setIsSubmitting(false);
    setIsComplete(false);
  }, [surveyOpen, survey, draft]);

  const questions = survey?.questions ?? [];
  const surveyTagline =
    survey?.tagline?.trim() || (questions.length ? formatSurveyTagline(questions.length) : SURVEY_TAGLINE);
  const prefaceHeading = survey?.prefaceHeading?.trim() || SURVEY_PREFACE_HEADING;
  const prefaceMessage = survey?.prefaceMessage?.trim() || SURVEY_PREFACE_MESSAGE;
  const currentQuestion = showPreface ? undefined : questions[currentIndex];
  const totalSteps = questions.length > 0 ? 1 + questions.length : 0;
  const completedSteps = showPreface ? 0 : currentIndex + 1;
  const progress =
    totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

  const canGoBack = !showPreface && !isSubmitting && !isComplete;
  const handleBack = () => {
    if (!canGoBack) return;
    if (currentIndex === 0) {
      setShowPreface(true);
      setError(null);
      return;
    }
    setCurrentIndex((index) => index - 1);
    setError(null);
  };
  const startQuestions = useCallback(() => {
    setShowPreface(false);
    setError(null);
    const progress: SurveyDraftProgress = { currentIndex: 0, showPreface: false };
    if (hasMeaningfulDraft(answers, progress)) {
      void saveDraft(progress);
    }
  }, [answers, saveDraft]);
  const isLastQuestion =
    !showPreface && questions.length > 0 && currentIndex === questions.length - 1;
  const selectedForCurrent = useMemo(
    () => (currentQuestion ? getSelected(answers[currentQuestion.id]) : []),
    [answers, currentQuestion],
  );

  const setSingleAnswer = (question: SurveyQuestion, optionId: string) => {
    setError(null);
    setAnswers((previous) => ({
      ...previous,
      [question.id]: optionId === "other"
        ? { selected: optionId, other: getOther(previous[question.id]) }
        : optionId,
    }));
  };

  const toggleMultiAnswer = (question: SurveyQuestion, optionId: string) => {
    setError(null);
    setAnswers((previous) => {
      const current = getSelected(previous[question.id]);
      const next = current.includes(optionId)
        ? current.filter((value) => value !== optionId)
        : [...current, optionId];
      const other = getOther(previous[question.id]);
      return {
        ...previous,
        [question.id]: next.includes("other") ? { selected: next, other } : next,
      };
    });
  };

  const setOtherAnswer = (question: SurveyQuestion, value: string) => {
    setAnswers((previous) => {
      const selected = getSelected(previous[question.id]);
      return {
        ...previous,
        [question.id]: { selected: question.type === "single" ? "other" : selected, other: value },
      };
    });
  };

  const setShortAnswer = (question: SurveyQuestion, value: string) => {
    setError(null);
    setAnswers((previous) => ({ ...previous, [question.id]: value }));
  };

  const validateCurrent = () => {
    if (!currentQuestion) return false;
    const value = answers[currentQuestion.id];
    if (!currentQuestion.required) return true;
    if (currentQuestion.type === "short") {
      if (typeof value === "string" && value.trim()) return true;
      setError("This question needs an answer before you continue.");
      return false;
    }
    const selected = getSelected(value);
    if (selected.length === 0) {
      setError("Choose at least one option before you continue.");
      return false;
    }
    if (selected.includes("other") && !getOther(value).trim()) {
      setError("Fill in the Other field before you continue.");
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!survey) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/survey/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ surveyId: survey.id, answers }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Could not submit survey");
      }
      setIsComplete(true);
      clearSnoozeForSurvey(survey.id);
      onSurveyCompleted();
      await refreshActive();
      window.setTimeout(() => closeSurvey({ snooze: false }), 1400);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const next = async () => {
    if (!validateCurrent()) return;

    const nextProgress: SurveyDraftProgress = showPreface
      ? { currentIndex: 0, showPreface: false }
      : isLastQuestion
        ? { currentIndex, showPreface: false }
        : { currentIndex: currentIndex + 1, showPreface: false };

    if (showPreface) {
      startQuestions();
      return;
    }

    if (isLastQuestion) {
      void submit();
      return;
    }

    await saveDraft(nextProgress);
    setCurrentIndex((index) => index + 1);
    setError(null);
  };

  useEffect(() => {
    if (!mounted || !surveyOpen || !survey) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dismissSurvey(true);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mounted, surveyOpen, survey, dismissSurvey]);

  if (!mounted || !surveyOpen || !survey) {
    return null;
  }

  if (!isComplete && !showPreface && !currentQuestion) {
    return null;
  }

  const content = (
    <div
      data-tfp-survey-popup
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden bg-slate-950/80 p-3 text-white backdrop-blur-xl sm:p-4"
      role="presentation"
      onClick={() => dismissSurvey(true)}
    >
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
        <div className="absolute -left-20 top-10 h-72 w-72 rounded-full bg-blue-500/30 blur-3xl" />
        <div className="absolute right-0 top-1/4 h-96 w-96 rounded-full bg-cyan-400/20 blur-3xl" />
        <div className="absolute bottom-0 left-1/3 h-80 w-80 rounded-full bg-violet-500/20 blur-3xl" />
      </div>

      <div
        className="relative z-10 flex max-h-[min(100dvh-1.5rem,56rem)] w-full max-w-3xl min-h-0 flex-col overflow-hidden rounded-2xl border border-white/15 bg-slate-900/95 shadow-2xl backdrop-blur-2xl sm:max-h-[min(100dvh-2rem,56rem)] sm:rounded-[2rem]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tfp-survey-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-white/10 bg-white/10 px-4 py-4 sm:px-8 sm:py-5">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0 flex-1 pr-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-200 sm:text-xs sm:tracking-[0.35em]">
                Round {survey.version}
              </p>
              <h2
                id="tfp-survey-title"
                className="mt-1.5 text-xl font-black tracking-tight sm:mt-2 sm:text-3xl"
              >
                {survey.title}
              </h2>
              <p className="mt-1.5 text-xs text-slate-200 sm:mt-2 sm:text-sm">
                {surveyTagline}
              </p>
            </div>
            <div className="flex shrink-0 items-start">
              <button
                type="button"
                onClick={() => dismissSurvey(true)}
                disabled={isComplete}
                className="rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-white/40 hover:bg-white/10 disabled:opacity-50"
              >
                Remind me later
              </button>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10 sm:mt-5 sm:h-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-8 sm:py-6">
          {isComplete ? (
            <div className="flex min-h-[12rem] flex-col items-center justify-center py-6 text-center sm:min-h-[16rem] sm:py-10">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-300/40 bg-emerald-400/20 text-4xl font-black text-emerald-200 shadow-[0_0_80px_rgba(52,211,153,0.35)] sm:mb-6 sm:h-24 sm:w-24 sm:text-5xl">
                ✓
              </div>
              <h3 className="text-2xl font-black sm:text-3xl">Thank you.</h3>
              <p className="mt-2 max-w-md text-sm text-slate-200 sm:mt-3 sm:text-base">
                Your feedback was submitted. This survey will not appear again for this round.
              </p>
            </div>
          ) : showPreface ? (
            <div className="flex flex-col justify-center py-2 sm:py-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200 sm:text-sm sm:tracking-[0.25em]">
                Before we begin
              </p>
              <h3 className="mt-3 text-xl font-black leading-snug text-white sm:mt-4 sm:text-2xl">
                {prefaceHeading}
              </h3>
              <p className="mt-4 text-base leading-relaxed text-slate-200 sm:mt-6 sm:text-lg">
                {prefaceMessage}
              </p>
            </div>
          ) : currentQuestion ? (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 sm:mb-6 sm:gap-4">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200 sm:text-sm sm:tracking-[0.25em]">
                  Question {currentIndex + 1} of {questions.length}
                </p>
                <p className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-semibold text-slate-200 sm:px-3 sm:py-1 sm:text-xs">
                  {currentQuestion.type === "multi" ? "Select all that apply" : currentQuestion.type === "short" ? "Short answer" : "Choose one"}
                </p>
              </div>

              <h3 className="text-lg font-black leading-snug text-white sm:text-2xl sm:leading-tight">
                {currentQuestion.prompt}
              </h3>

              <div className="mt-4 space-y-2 sm:mt-7 sm:space-y-3">
                {currentQuestion.type !== "short" ? (
                  <>
                    {currentQuestion.options?.map((option) => {
                      const active = selectedForCurrent.includes(option.id);
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() =>
                            currentQuestion.type === "single"
                              ? setSingleAnswer(currentQuestion, option.id)
                              : toggleMultiAnswer(currentQuestion, option.id)
                          }
                          className={`group flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-3 text-left transition duration-200 sm:rounded-2xl sm:px-5 sm:py-4 ${
                            active
                              ? "border-cyan-300/70 bg-cyan-300/15 shadow-[0_0_40px_rgba(34,211,238,0.18)]"
                              : "border-white/10 bg-white/5 hover:border-white/30 hover:bg-white/10"
                          }`}
                        >
                          <span className="text-sm font-semibold text-white sm:text-base">{option.label}</span>
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full border text-xs font-black transition ${
                              active ? "border-cyan-200 bg-cyan-200 text-slate-950" : "border-white/25 text-white/40 group-hover:text-white"
                            }`}
                          >
                            {active ? "✓" : ""}
                          </span>
                        </button>
                      );
                    })}
                    {currentQuestion.allowOther ? (
                      <div
                        className={`rounded-2xl border p-4 transition ${
                          selectedForCurrent.includes("other")
                            ? "border-violet-300/70 bg-violet-300/15"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() =>
                            currentQuestion.type === "single"
                              ? setSingleAnswer(currentQuestion, "other")
                              : toggleMultiAnswer(currentQuestion, "other")
                          }
                          className="flex w-full items-center justify-between text-left font-semibold"
                        >
                          <span>Other</span>
                          <span className="text-sm text-slate-300">
                            {selectedForCurrent.includes("other") ? "Selected" : "Tap to select"}
                          </span>
                        </button>
                        {selectedForCurrent.includes("other") ? (
                          <input
                            value={getOther(answers[currentQuestion.id])}
                            onChange={(event) => setOtherAnswer(currentQuestion, event.target.value)}
                            placeholder="Type your answer"
                            className="mt-4 w-full rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none ring-0 transition placeholder:text-slate-500 focus:border-cyan-300"
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <textarea
                    value={typeof answers[currentQuestion.id] === "string" ? (answers[currentQuestion.id] as string) : ""}
                    onChange={(event) => setShortAnswer(currentQuestion, event.target.value)}
                    placeholder="Type your thoughts here..."
                    rows={5}
                    className="min-h-[8rem] w-full resize-y rounded-xl border border-white/10 bg-slate-950/50 px-4 py-3 text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300 sm:min-h-[10rem] sm:rounded-2xl sm:px-5 sm:py-4"
                  />
                )}
              </div>

              {error ? (
                <div className="mt-5 rounded-2xl border border-red-300/30 bg-red-500/15 px-4 py-3 text-sm font-semibold text-red-100">
                  {error}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {!isComplete ? (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-slate-900/95 px-4 py-3 sm:gap-4 sm:px-8 sm:py-5">
            {showPreface ? (
              <button
                type="button"
                onClick={startQuestions}
                disabled={isSavingDraft}
                className="ml-auto w-full rounded-lg bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 px-6 py-2.5 text-sm font-black text-slate-950 shadow-[0_0_50px_rgba(34,211,238,0.25)] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:rounded-xl sm:px-8 sm:py-3"
              >
                {isSavingDraft ? "Saving..." : "Get started"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleBack}
                  disabled={!canGoBack}
                  className="rounded-lg border border-white/10 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 sm:rounded-xl sm:px-5 sm:py-3"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => void next()}
                  disabled={isSubmitting || isSavingDraft}
                  className="rounded-lg bg-gradient-to-r from-cyan-300 via-blue-400 to-violet-400 px-5 py-2.5 text-sm font-black text-slate-950 shadow-[0_0_50px_rgba(34,211,238,0.25)] transition hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60 sm:rounded-xl sm:px-7 sm:py-3"
                >
                  {isSubmitting
                    ? "Submitting..."
                    : isSavingDraft
                      ? "Saving..."
                      : isLastQuestion
                        ? "Submit survey"
                        : "Continue"}
                </button>
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
