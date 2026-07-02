"use client";

import { useEffect, useState } from "react";

type ChoiceResult = {
  id: string;
  label: string;
  count: number;
  percentage: number;
};

export type QuestionOverview = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
  options?: ChoiceResult[];
  answers?: Array<{ responseId: string; userName?: string | null; userEmail: string; text: string }>;
  otherTexts?: Array<{ responseId: string; userEmail: string; text: string }>;
};

function ChoiceBars({ question }: { question: QuestionOverview }) {
  const options = question.options || [];
  const rowCount = options.length + (question.otherTexts?.length ? 1 : 0);

  return (
    <div
      className="grid min-h-0 flex-1 gap-1 overflow-hidden"
      style={{
        gridTemplateRows: `repeat(${Math.max(rowCount, 1)}, minmax(0, 1fr))`,
      }}
    >
      {options.map((option) => (
        <div
          key={option.id}
          className="flex min-h-0 flex-col justify-center rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1 sm:px-3 sm:py-1.5"
        >
          <div className="flex items-center justify-between gap-2 text-[11px] leading-tight sm:text-xs">
            <span className="min-w-0 truncate font-medium text-white">{option.label}</span>
            <span className="shrink-0 tabular-nums text-slate-400">
              {option.count} ({option.percentage}%)
            </span>
          </div>
          <div className="mt-1 h-1.5 shrink-0 overflow-hidden rounded-full bg-white/10 sm:h-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-blue-500 transition-all"
              style={{ width: `${Math.min(100, option.percentage)}%` }}
            />
          </div>
        </div>
      ))}
      {question.otherTexts?.length ? (
        <div className="flex min-h-0 flex-col justify-center overflow-hidden rounded-lg border border-violet-300/20 bg-violet-400/10 px-2 py-1 sm:px-3 sm:py-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet-200">Other</p>
          <div className="mt-0.5 min-h-0 space-y-0.5 overflow-y-auto">
            {question.otherTexts.map((other) => (
              <p key={`${other.responseId}-${other.text}`} className="truncate text-[11px] text-slate-200">
                <span className="font-semibold text-white">{other.userEmail}:</span> {other.text}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function QuestionCard({ question, index, total }: { question: QuestionOverview; index: number; total: number }) {
  const isChoice = question.type !== "short";
  const answerCount = question.answers?.length || 0;

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/10 p-4 shadow-xl backdrop-blur sm:rounded-3xl sm:p-5">
      <div className="mb-3 shrink-0 sm:mb-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-200 sm:text-xs sm:tracking-[0.25em]">
          Question {index + 1} of {total} · {question.type}
        </p>
        <h2 className="mt-1.5 line-clamp-3 text-base font-black leading-snug text-white sm:mt-2 sm:text-xl lg:text-2xl">
          {question.prompt}
        </h2>
      </div>

      {question.type === "short" ? (
        <div
          className="grid min-h-0 flex-1 gap-1 overflow-y-auto"
          style={{
            gridTemplateRows: `repeat(${Math.max(answerCount, 1)}, minmax(min-content, 1fr))`,
          }}
        >
          {question.answers?.length ? (
            question.answers.map((answer) => (
              <div
                key={answer.responseId}
                className="flex min-h-0 flex-col justify-center rounded-lg border border-white/10 bg-slate-950/40 px-2 py-1.5 sm:px-3"
              >
                <p className="line-clamp-3 whitespace-pre-wrap text-[11px] text-slate-200 sm:text-sm">
                  {answer.text}
                </p>
                <p className="mt-0.5 truncate text-[10px] font-semibold text-slate-500">
                  {answer.userName || answer.userEmail}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-400">No written responses yet.</p>
          )}
        </div>
      ) : isChoice ? (
        <ChoiceBars question={question} />
      ) : null}
    </div>
  );
}

type Props = {
  questions: QuestionOverview[];
  resetKey?: string;
};

export default function DevSurveyQuestionOverview({ questions, resetKey }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setActiveIndex(0);
  }, [resetKey, questions.length]);

  useEffect(() => {
    if (activeIndex >= questions.length) {
      setActiveIndex(Math.max(0, questions.length - 1));
    }
  }, [activeIndex, questions.length]);

  if (questions.length === 0) {
    return (
      <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-sm text-slate-400">
        No questions in this survey round.
      </div>
    );
  }

  const activeQuestion = questions[activeIndex];

  return (
    <div className="flex h-full min-h-[12rem] w-full flex-1 flex-col gap-3">
      <div className="flex w-full shrink-0 gap-1 rounded-xl border border-white/10 bg-slate-900/80 p-1">
        {questions.map((question, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              key={question.id}
              type="button"
              title={question.prompt}
              onClick={() => setActiveIndex(index)}
              className={`min-w-0 flex-1 rounded-lg px-1.5 py-2 text-center text-xs font-bold transition sm:px-2 sm:py-2.5 sm:text-sm ${
                isActive
                  ? "bg-gradient-to-r from-cyan-400/30 to-blue-500/30 text-white shadow"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              Q{index + 1}
            </button>
          );
        })}
      </div>
      {activeQuestion ? (
        <QuestionCard
          question={activeQuestion}
          index={activeIndex}
          total={questions.length}
        />
      ) : null}
    </div>
  );
}
