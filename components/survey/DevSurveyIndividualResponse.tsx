"use client";

import { useMemo } from "react";

type QuestionSummary = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
};

type ResponseDetail = {
  id: string;
  userId: string;
  userName?: string | null;
  userEmail: string;
  department?: string | null;
  status: "COMPLETE" | "INCOMPLETE";
  submittedAt: string | null;
  updatedAt: string | null;
  answers: Array<{ questionId: string; prompt: string; value: string }>;
};

type Props = {
  questions: QuestionSummary[];
  response: ResponseDetail;
};

export default function DevSurveyIndividualResponse({ questions, response }: Props) {
  const answerByQuestionId = useMemo(
    () => new Map(response.answers.map((answer) => [answer.questionId, answer])),
    [response.answers],
  );

  const timestampLabel =
    response.status === "COMPLETE" && response.submittedAt
      ? `Submitted ${new Date(response.submittedAt).toLocaleString()}`
      : response.updatedAt
        ? `Last saved ${new Date(response.updatedAt).toLocaleString()}`
        : "No timestamp";

  return (
    <div className="w-full space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/10 p-6 shadow-xl backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black text-white">
              {response.userName || response.userEmail}
            </h2>
            <p className="mt-1 text-sm text-slate-400">{response.userEmail}</p>
            <p className="mt-1 text-sm text-slate-300">
              {response.department || "No department"}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${
              response.status === "COMPLETE"
                ? "bg-emerald-400/20 text-emerald-200"
                : "bg-sky-400/20 text-sky-200"
            }`}
          >
            {response.status === "COMPLETE" ? "Complete" : "Draft"}
          </span>
        </div>
        <p className="mt-3 text-xs text-slate-500">{timestampLabel}</p>
      </div>

      <div className="space-y-4">
        {questions.map((question, index) => {
          const answer = answerByQuestionId.get(question.id);
          const value = answer?.value?.trim() || "";
          const isShort = question.type === "short";

          return (
            <div
              key={question.id}
              className="rounded-2xl border border-white/10 bg-slate-950/40 p-5"
            >
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-200">
                Question {index + 1} of {questions.length} · {question.type}
              </p>
              <h3 className="mt-2 text-lg font-bold text-white">{question.prompt}</h3>
              {value ? (
                <p
                  className={`mt-3 text-slate-200 ${isShort ? "whitespace-pre-wrap text-sm leading-relaxed" : "text-sm"}`}
                >
                  {value}
                </p>
              ) : (
                <p className="mt-3 text-sm italic text-slate-500">No answer yet</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
