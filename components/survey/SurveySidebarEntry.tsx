"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import {
  countAnsweredQuestions,
  useSurvey,
} from "@/lib/survey/SurveyContext";

type Props = {
  collapsed: boolean;
};

function QuestionMarkIcon({ className }: { className?: string }) {
  return (
    <span
      className={`flex h-full w-full items-center justify-center text-xl font-bold leading-none ${className ?? ""}`}
      aria-hidden
    >
      ?
    </span>
  );
}

export default function SurveySidebarEntry({ collapsed }: Props) {
  const { data: session } = useSession();
  const isDeveloper = !!(session?.user as { isDeveloper?: boolean } | undefined)
    ?.isDeveloper;
  const { canResume, pendingSurvey, draft, openSurvey, refreshActive } = useSurvey();

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshActive();
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [refreshActive]);

  if (isDeveloper || !canResume || !pendingSurvey) {
    return null;
  }

  const answeredCount = countAnsweredQuestions(
    pendingSurvey.questions,
    draft?.answers || {},
  );
  const totalQuestions = pendingSurvey.questions.length;
  const hasDraft =
    answeredCount > 0 ||
    (draft?.progress &&
      (draft.progress.currentIndex > 0 || !draft.progress.showPreface));

  const subtitle =
    answeredCount > 0
      ? `Continue · ${answeredCount}/${totalQuestions} answered`
      : "Start survey";

  if (collapsed) {
    return (
      <div className="flex shrink-0 justify-center border-t border-gray-200 px-2 py-4 dark:border-slate-700">
        <button
          type="button"
          onClick={openSurvey}
          title="Resume survey"
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-600 transition hover:bg-amber-50 hover:text-amber-700 dark:text-slate-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-200"
        >
          <QuestionMarkIcon className="text-amber-700 dark:text-amber-200" />
          {hasDraft ? (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-white dark:ring-slate-900" />
          ) : null}
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-gray-200 px-2 py-4 dark:border-slate-700">
      <button
        type="button"
        onClick={openSurvey}
        className="flex w-full items-center gap-3 rounded-lg border border-amber-200/80 bg-amber-50 px-4 py-3 text-left transition hover:bg-amber-100 dark:border-amber-400/30 dark:bg-amber-500/10 dark:hover:bg-amber-500/20"
      >
      <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center text-amber-700 dark:text-amber-200">
        <QuestionMarkIcon />
        {hasDraft ? (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400" />
        ) : null}
      </span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-slate-900 dark:text-white">
            TFP Survey
          </span>
          <span className="block truncate text-xs text-amber-800/80 dark:text-amber-100/80">
            {subtitle}
          </span>
        </span>
      </button>
    </div>
  );
}
