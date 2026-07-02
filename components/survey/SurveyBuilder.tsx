"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  defaultSurveyBuilderPayload,
  slugifySurveyId,
  type SurveyBuilderPayload,
} from "@/lib/survey/surveyBuilder";
import { formatSurveyTagline } from "@/lib/survey/surveyQuestions";
import type {
  SurveyQuestion,
  SurveyQuestionOption,
  SurveyQuestionType,
} from "@/lib/survey/surveyQuestions";

type Props = {
  surveyId?: string;
};

const QUESTION_TYPE_LABELS: Record<SurveyQuestionType, string> = {
  single: "Single choice",
  multi: "Multi select",
  short: "Short answer",
};

const QUESTION_TYPE_SHORT: Record<SurveyQuestionType, string> = {
  single: "Single",
  multi: "Multi",
  short: "Short",
};

function newQuestion(type: SurveyQuestionType = "single"): SurveyQuestion {
  const index = Date.now();
  if (type === "short") {
    return {
      id: `question_${index}`,
      prompt: "",
      type: "short",
      required: false,
    };
  }
  return {
    id: `question_${index}`,
    prompt: "",
    type,
    required: true,
    allowOther: false,
    options: [
      { id: "option_1", label: "Option 1" },
      { id: "option_2", label: "Option 2" },
    ],
  };
}

function isQuestionIncomplete(question: SurveyQuestion): boolean {
  if (!question.id.trim() || !question.prompt.trim()) return true;
  if (question.type === "short") return false;
  const options = question.options || [];
  if (options.length === 0) return true;
  return options.some((option) => !option.label.trim() || !option.id.trim());
}

function questionTabTitle(question: SurveyQuestion, index: number): string {
  return [
    `Question ${index + 1}`,
    QUESTION_TYPE_LABELS[question.type],
    question.prompt.trim() || "(no prompt yet)",
  ].join(" · ");
}

const inputClass =
  "w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-500/20";
const labelClass =
  "mb-1.5 block text-xs font-bold uppercase tracking-[0.2em] text-slate-400";

export default function SurveyBuilder({ surveyId }: Props) {
  const router = useRouter();
  const isEdit = !!surveyId;
  const [payload, setPayload] = useState<SurveyBuilderPayload>(
    defaultSurveyBuilderPayload(),
  );
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);
  const [detailsExpanded, setDetailsExpanded] = useState(true);
  const [isLoading, setIsLoading] = useState(isEdit);
  const [isSaving, setIsSaving] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savedId, setSavedId] = useState(surveyId || "");

  useEffect(() => {
    if (!surveyId) return;
    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(
          `/api/dev/survey/${encodeURIComponent(surveyId)}`,
          { cache: "no-store" },
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || "Failed to load survey");
        if (cancelled) return;
        const survey = data.survey;
        if (survey.status !== "DRAFT") {
          router.replace("/dev/survey");
          return;
        }
        const questions = Array.isArray(survey.questions) ? survey.questions : [];
        setPayload({
          title: survey.title,
          tagline: survey.tagline,
          prefaceHeading: survey.prefaceHeading,
          prefaceMessage: survey.prefaceMessage,
          questions,
        });
        setSavedId(survey.id);
        setActiveQuestionIndex(0);
        setDetailsExpanded(questions.length === 0);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [surveyId, router]);

  useEffect(() => {
    if (activeQuestionIndex >= payload.questions.length) {
      setActiveQuestionIndex(Math.max(0, payload.questions.length - 1));
    }
  }, [activeQuestionIndex, payload.questions.length]);

  const effectiveTagline = useMemo(() => {
    if (payload.tagline?.trim()) return payload.tagline.trim();
    return formatSurveyTagline(payload.questions.length);
  }, [payload.tagline, payload.questions.length]);

  const incompleteQuestionCount = useMemo(
    () => payload.questions.filter(isQuestionIncomplete).length,
    [payload.questions],
  );

  const activeQuestion = payload.questions[activeQuestionIndex] ?? null;

  const updateQuestion = useCallback(
    (index: number, patch: Partial<SurveyQuestion>) => {
      setPayload((previous) => {
        const questions = [...previous.questions];
        const current = { ...questions[index], ...patch };
        if (patch.type === "short") {
          current.options = undefined;
          current.allowOther = false;
        } else if (
          (patch.type === "single" || patch.type === "multi") &&
          !current.options?.length
        ) {
          current.options = [
            { id: "option_1", label: "Option 1" },
            { id: "option_2", label: "Option 2" },
          ];
        }
        questions[index] = current;
        return { ...previous, questions };
      });
    },
    [],
  );

  const reorderQuestions = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    setPayload((previous) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= previous.questions.length ||
        toIndex >= previous.questions.length
      ) {
        return previous;
      }
      const questions = [...previous.questions];
      const [item] = questions.splice(fromIndex, 1);
      questions.splice(toIndex, 0, item);
      return { ...previous, questions };
    });

    setActiveQuestionIndex((active) => {
      if (active === fromIndex) return toIndex;
      if (fromIndex < active && toIndex >= active) return active - 1;
      if (fromIndex > active && toIndex <= active) return active + 1;
      return active;
    });
  }, []);

  const moveQuestion = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= payload.questions.length) return;
    reorderQuestions(index, nextIndex);
  };

  const removeQuestion = (index: number) => {
    setPayload((previous) => ({
      ...previous,
      questions: previous.questions.filter((_, i) => i !== index),
    }));
    setActiveQuestionIndex((active) => {
      if (active > index) return active - 1;
      if (active === index) return Math.max(0, index - 1);
      return active;
    });
    if (payload.questions.length <= 1) {
      setDetailsExpanded(true);
    }
  };

  const addQuestion = (type: SurveyQuestionType) => {
    setPayload((previous) => {
      const questions = [...previous.questions, newQuestion(type)];
      setActiveQuestionIndex(questions.length - 1);
      if (previous.questions.length === 0) {
        setDetailsExpanded(false);
      }
      return { ...previous, questions };
    });
  };

  const updateOption = (
    questionIndex: number,
    optionIndex: number,
    patch: Partial<SurveyQuestionOption>,
  ) => {
    setPayload((previous) => {
      const questions = [...previous.questions];
      const question = { ...questions[questionIndex] };
      const options = [...(question.options || [])];
      options[optionIndex] = { ...options[optionIndex], ...patch };
      question.options = options;
      questions[questionIndex] = question;
      return { ...previous, questions };
    });
  };

  const addOption = (questionIndex: number) => {
    setPayload((previous) => {
      const questions = [...previous.questions];
      const question = { ...questions[questionIndex] };
      const options = [...(question.options || [])];
      const next = options.length + 1;
      options.push({ id: `option_${next}`, label: `Option ${next}` });
      question.options = options;
      questions[questionIndex] = question;
      return { ...previous, questions };
    });
  };

  const removeOption = (questionIndex: number, optionIndex: number) => {
    setPayload((previous) => {
      const questions = [...previous.questions];
      const question = { ...questions[questionIndex] };
      question.options = (question.options || []).filter(
        (_, i) => i !== optionIndex,
      );
      questions[questionIndex] = question;
      return { ...previous, questions };
    });
  };

  const persist = async (): Promise<string> => {
    const id = savedId || surveyId || "";
    const response = await fetch(
      id ? `/api/dev/survey/${encodeURIComponent(id)}` : "/api/dev/survey",
      {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data?.error || "Could not save survey");
    const surveyIdFromResponse = data.survey?.id as string;
    if (!id && surveyIdFromResponse) {
      setSavedId(surveyIdFromResponse);
      window.history.replaceState(
        null,
        "",
        `/dev/survey/${surveyIdFromResponse}/edit`,
      );
    }
    return surveyIdFromResponse || id;
  };

  const saveDraft = async () => {
    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      await persist();
      setSuccess("Draft saved.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  const launchNow = async () => {
    try {
      setIsLaunching(true);
      setError(null);
      setSuccess(null);
      const id = await persist();
      const response = await fetch(
        `/api/dev/survey/${encodeURIComponent(id)}/launch`,
        { method: "POST" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Could not launch survey");
      router.push(`/dev/survey?round=${encodeURIComponent(id)}`);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsLaunching(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center text-slate-300">
        Loading survey builder...
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col lg:h-full">
      <header className="shrink-0 space-y-3 border-b border-white/10 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-200">
              {isEdit ? "Edit draft" : "New survey"}
            </p>
            <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">
              Survey builder
            </h1>
            <p className="mt-1 hidden text-sm text-slate-400 lg:block">
              Draft-only editing · Launch closes the active round ·{" "}
              {payload.questions.length} question
              {payload.questions.length === 1 ? "" : "s"}
              {incompleteQuestionCount > 0
                ? ` · ${incompleteQuestionCount} incomplete`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/dev/survey"
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
            >
              Cancel
            </Link>
            <button
              type="button"
              onClick={() => void saveDraft()}
              disabled={isSaving || isLaunching}
              className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-white/10 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save draft"}
            </button>
            <button
              type="button"
              onClick={() => void launchNow()}
              disabled={
                isSaving ||
                isLaunching ||
                payload.questions.length === 0 ||
                incompleteQuestionCount > 0
              }
              title={
                incompleteQuestionCount > 0
                  ? "Complete all questions before launching"
                  : undefined
              }
              className="rounded-xl bg-gradient-to-r from-cyan-300 to-blue-500 px-5 py-2.5 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:opacity-50"
            >
              {isLaunching ? "Launching..." : "Launch now"}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-300/30 bg-red-500/15 px-4 py-2.5 text-sm text-red-100">
            {error}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/15 px-4 py-2.5 text-sm text-emerald-100">
            {success}
          </div>
        ) : null}
      </header>

      <SurveyDetailsCollapsible
        expanded={detailsExpanded}
        onToggle={() => setDetailsExpanded((open) => !open)}
        payload={payload}
        effectiveTagline={effectiveTagline}
        onPayloadChange={setPayload}
      />

      <div className="mt-4 flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] lg:mt-3 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <QuestionNavigationRail
            questions={payload.questions}
            activeIndex={activeQuestionIndex}
            incompleteQuestionCount={incompleteQuestionCount}
            onSelect={setActiveQuestionIndex}
            onReorder={reorderQuestions}
            onAddQuestion={addQuestion}
            className="hidden lg:flex"
          />

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {payload.questions.length > 0 ? (
              <>
                <QuestionNavigationChips
                  questions={payload.questions}
                  activeIndex={activeQuestionIndex}
                  onSelect={setActiveQuestionIndex}
                  className="border-b border-white/10 lg:hidden"
                />
                <div className="flex flex-wrap gap-1.5 border-b border-white/10 p-2 lg:hidden">
                  <button
                    type="button"
                    onClick={() => addQuestion("single")}
                    className="rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-bold text-cyan-100"
                  >
                    + Single
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuestion("multi")}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-300"
                  >
                    + Multi
                  </button>
                  <button
                    type="button"
                    onClick={() => addQuestion("short")}
                    className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs font-bold text-slate-300"
                  >
                    + Short
                  </button>
                </div>
              </>
            ) : null}

            <div className="min-w-0 flex-1 p-4 lg:min-h-0 lg:overflow-y-auto lg:p-5">
              {payload.questions.length === 0 ? (
                <EmptyQuestionsState onAddQuestion={addQuestion} />
              ) : activeQuestion ? (
                <QuestionEditor
                  question={activeQuestion}
                  index={activeQuestionIndex}
                  total={payload.questions.length}
                  onUpdate={(patch) =>
                    updateQuestion(activeQuestionIndex, patch)
                  }
                  onMoveUp={() => moveQuestion(activeQuestionIndex, -1)}
                  onMoveDown={() => moveQuestion(activeQuestionIndex, 1)}
                  onRemove={() => removeQuestion(activeQuestionIndex)}
                  onAddOption={() => addOption(activeQuestionIndex)}
                  onUpdateOption={(optionIndex, patch) =>
                    updateOption(activeQuestionIndex, optionIndex, patch)
                  }
                  onRemoveOption={(optionIndex) =>
                    removeOption(activeQuestionIndex, optionIndex)
                  }
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type SurveyDetailsCollapsibleProps = {
  expanded: boolean;
  onToggle: () => void;
  payload: SurveyBuilderPayload;
  effectiveTagline: string;
  onPayloadChange: Dispatch<SetStateAction<SurveyBuilderPayload>>;
};

function SurveyDetailsCollapsible({
  expanded,
  onToggle,
  payload,
  effectiveTagline,
  onPayloadChange,
}: SurveyDetailsCollapsibleProps) {
  const summaryTitle = payload.title.trim() || "Untitled survey";

  return (
    <div className="mt-3 shrink-0 rounded-2xl border border-white/10 bg-white/[0.04]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03] sm:px-5"
        aria-expanded={expanded}
      >
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
            Survey details
          </p>
          <p className="truncate text-sm font-semibold text-white">
            {summaryTitle}
            <span className="font-normal text-slate-500"> · {effectiveTagline}</span>
          </p>
        </div>
        <span className="shrink-0 text-slate-400" aria-hidden>
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="border-t border-white/10 px-4 pb-5 pt-4 sm:px-5">
            <p className="mb-4 text-sm text-slate-500">
              Shown at the start of the survey before questions.
            </p>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className={labelClass}>Title</label>
                <input
                  className={inputClass}
                  value={payload.title}
                  onChange={(e) =>
                    onPayloadChange((p) => ({ ...p, title: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className={labelClass}>Tagline</label>
                <input
                  className={inputClass}
                  value={payload.tagline || ""}
                  placeholder={formatSurveyTagline(payload.questions.length)}
                  onChange={(e) =>
                    onPayloadChange((p) => ({
                      ...p,
                      tagline: e.target.value || null,
                    }))
                  }
                />
                <p className="mt-1.5 text-xs text-slate-500">
                  Empty uses: {effectiveTagline}
                </p>
              </div>
              <div>
                <label className={labelClass}>Preface heading</label>
                <input
                  className={inputClass}
                  value={payload.prefaceHeading || ""}
                  onChange={(e) =>
                    onPayloadChange((p) => ({
                      ...p,
                      prefaceHeading: e.target.value || null,
                    }))
                  }
                />
              </div>
              <div className="md:col-span-2">
                <label className={labelClass}>Preface message</label>
                <textarea
                  className={`${inputClass} min-h-[88px] resize-y`}
                  value={payload.prefaceMessage || ""}
                  onChange={(e) =>
                    onPayloadChange((p) => ({
                      ...p,
                      prefaceMessage: e.target.value || null,
                    }))
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

type QuestionNavProps = {
  questions: SurveyQuestion[];
  activeIndex: number;
  onSelect: (index: number) => void;
  className?: string;
};

function DragGripIcon() {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="5" cy="4" r="1.25" />
      <circle cx="11" cy="4" r="1.25" />
      <circle cx="5" cy="8" r="1.25" />
      <circle cx="11" cy="8" r="1.25" />
      <circle cx="5" cy="12" r="1.25" />
      <circle cx="11" cy="12" r="1.25" />
    </svg>
  );
}

function QuestionNavigationRail({
  questions,
  activeIndex,
  incompleteQuestionCount,
  onSelect,
  onReorder,
  onAddQuestion,
  className = "",
}: QuestionNavProps & {
  incompleteQuestionCount: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onAddQuestion: (type: SurveyQuestionType) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const finishDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDrop = (toIndex: number) => {
    if (dragIndex === null || dragIndex === toIndex) {
      finishDrag();
      return;
    }
    onReorder(dragIndex, toIndex);
    finishDrag();
  };

  return (
    <aside
      className={`w-52 shrink-0 flex-col border-r border-white/10 bg-slate-950/40 xl:w-56 ${className}`}
    >
      <div className="shrink-0 border-b border-white/10 px-3 py-3">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
          Questions
        </p>
        <p className="mt-0.5 text-sm font-semibold text-white">
          {questions.length}
          {incompleteQuestionCount > 0 ? (
            <span className="ml-1 text-amber-300">
              · {incompleteQuestionCount} incomplete
            </span>
          ) : null}
        </p>
        {questions.length > 1 ? (
          <p className="mt-1 text-[10px] text-slate-600">Drag grip to reorder</p>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2 [-ms-overflow-style:none] [scrollbar-width:thin]">
        {questions.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-500">Add a question below.</p>
        ) : (
          <ul className="space-y-1">
            {questions.map((question, index) => {
              const isActive = index === activeIndex;
              const incomplete = isQuestionIncomplete(question);
              const promptPreview = question.prompt.trim();
              const isDragging = dragIndex === index;
              const isDropTarget = dropIndex === index && dragIndex !== null && dragIndex !== index;

              return (
                <li
                  key={`q-nav-${index}`}
                  className={`rounded-xl transition ${
                    isDropTarget ? "ring-2 ring-cyan-400/50 ring-offset-1 ring-offset-slate-950" : ""
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    if (dragIndex !== null) setDropIndex(index);
                  }}
                  onDragLeave={(event) => {
                    const next = event.relatedTarget as Node | null;
                    if (next && event.currentTarget.contains(next)) return;
                    if (dropIndex === index) setDropIndex(null);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    handleDrop(index);
                  }}
                >
                  <div
                    data-question-row
                    className={`flex min-h-[44px] overflow-hidden rounded-xl transition ${
                      isActive
                        ? "bg-gradient-to-r from-cyan-400/25 to-blue-500/20"
                        : "hover:bg-white/5"
                    } ${isDragging ? "opacity-40" : ""}`}
                  >
                    <div
                      draggable
                      title="Drag to reorder"
                      aria-label={`Drag to reorder question ${index + 1}`}
                      onDragStart={(event) => {
                        setDragIndex(index);
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", String(index));
                        const row = event.currentTarget.closest("[data-question-row]");
                        if (row instanceof HTMLElement) {
                          event.dataTransfer.setDragImage(row, 24, 24);
                        }
                      }}
                      onDragEnd={finishDrag}
                      className="flex shrink-0 cursor-grab items-center px-1.5 text-slate-600 active:cursor-grabbing hover:text-slate-400"
                    >
                      <DragGripIcon />
                    </div>
                    <button
                      type="button"
                      title={questionTabTitle(question, index)}
                      onClick={() => onSelect(index)}
                      className={`flex min-w-0 flex-1 flex-col items-start py-2.5 pr-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-cyan-400/50 ${
                        isActive ? "text-white" : "text-slate-400 hover:text-white"
                      }`}
                    >
                      <span className="flex w-full items-center gap-1.5 text-sm font-bold">
                        Q{index + 1}
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                          {QUESTION_TYPE_SHORT[question.type]}
                        </span>
                        {incomplete ? (
                          <span
                            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                            aria-label="Needs attention"
                          />
                        ) : null}
                      </span>
                      {promptPreview ? (
                        <span className="mt-0.5 line-clamp-2 text-xs font-normal text-slate-500">
                          {promptPreview}
                        </span>
                      ) : (
                        <span className="mt-0.5 text-xs italic text-slate-600">
                          No prompt yet
                        </span>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-white/10 p-2">
        <button
          type="button"
          onClick={() => onAddQuestion("single")}
          className="w-full rounded-lg border border-cyan-300/25 bg-cyan-500/10 px-2 py-2 text-xs font-bold text-cyan-100 transition hover:bg-cyan-500/20"
        >
          + Single choice
        </button>
        <button
          type="button"
          onClick={() => onAddQuestion("multi")}
          className="w-full rounded-lg border border-white/10 px-2 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10"
        >
          + Multi select
        </button>
        <button
          type="button"
          onClick={() => onAddQuestion("short")}
          className="w-full rounded-lg border border-white/10 px-2 py-2 text-xs font-bold text-slate-300 transition hover:bg-white/10"
        >
          + Short answer
        </button>
      </div>
    </aside>
  );
}

function QuestionNavigationChips({
  questions,
  activeIndex,
  onSelect,
  className = "",
}: QuestionNavProps) {
  return (
    <div
      className={`flex gap-1 overflow-x-auto p-2 [-ms-overflow-style:none] [scrollbar-width:thin] ${className}`}
    >
      {questions.map((question, index) => {
        const isActive = index === activeIndex;
        const incomplete = isQuestionIncomplete(question);
        return (
          <button
            key={`q-chip-${index}`}
            type="button"
            title={questionTabTitle(question, index)}
            onClick={() => onSelect(index)}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition ${
              isActive
                ? "bg-gradient-to-r from-cyan-400/30 to-blue-500/30 text-white"
                : "border border-white/10 text-slate-400"
            }`}
          >
            Q{index + 1}
            {incomplete ? (
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function EmptyQuestionsState({
  onAddQuestion,
}: {
  onAddQuestion: (type: SurveyQuestionType) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-slate-950/30 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-300">No questions yet</p>
      <p className="mt-2 max-w-sm text-sm text-slate-500">
        Add at least one question before launching. Use the left rail on desktop or
        the buttons below.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => onAddQuestion("single")}
          className="rounded-xl bg-gradient-to-r from-cyan-300/90 to-blue-500/90 px-4 py-2.5 text-sm font-bold text-slate-950"
        >
          + Single choice
        </button>
        <button
          type="button"
          onClick={() => onAddQuestion("multi")}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
        >
          + Multi select
        </button>
        <button
          type="button"
          onClick={() => onAddQuestion("short")}
          className="rounded-xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10"
        >
          + Short answer
        </button>
      </div>
    </div>
  );
}

type QuestionEditorProps = {
  question: SurveyQuestion;
  index: number;
  total: number;
  onUpdate: (patch: Partial<SurveyQuestion>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onAddOption: () => void;
  onUpdateOption: (
    optionIndex: number,
    patch: Partial<SurveyQuestionOption>,
  ) => void;
  onRemoveOption: (optionIndex: number) => void;
};

function shouldSyncOptionIdFromLabel(
  option: SurveyQuestionOption,
  nextLabel: string,
): boolean {
  const nextSlug = slugifySurveyId(nextLabel);
  if (!nextSlug) return false;
  const currentSlug = slugifySurveyId(option.label);
  if (!option.id || option.id === currentSlug) return true;
  return /^option_\d+$/i.test(option.id);
}

function QuestionEditor({
  question,
  index,
  total,
  onUpdate,
  onMoveUp,
  onMoveDown,
  onRemove,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
}: QuestionEditorProps) {
  const incomplete = isQuestionIncomplete(question);

  const handleOptionLabelBlur = (optionIndex: number, label: string) => {
    const option = question.options?.[optionIndex];
    if (!option) return;
    if (!shouldSyncOptionIdFromLabel(option, label)) return;
    const nextId = slugifySurveyId(label);
    if (nextId && nextId !== option.id) {
      onUpdateOption(optionIndex, { id: nextId });
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/40 p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200">
            Question {index + 1} of {total}
          </p>
          <p className="mt-1 text-sm text-slate-400">
            {QUESTION_TYPE_LABELS[question.type]}
            {incomplete ? (
              <span className="ml-2 text-amber-300">· Incomplete</span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={onMoveUp}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            Move up
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={onMoveDown}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
          >
            Move down
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded-lg border border-red-400/30 px-3 py-1.5 text-xs font-semibold text-red-200 transition hover:bg-red-500/10"
          >
            Remove
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className={labelClass}>Type</label>
          <select
            className={inputClass}
            value={question.type}
            onChange={(e) =>
              onUpdate({ type: e.target.value as SurveyQuestionType })
            }
          >
            <option value="single">Single choice</option>
            <option value="multi">Multi select</option>
            <option value="short">Short answer</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>Question ID</label>
          <input
            className={inputClass}
            value={question.id}
            onChange={(e) =>
              onUpdate({ id: slugifySurveyId(e.target.value) })
            }
          />
        </div>
        <div className="md:col-span-2">
          <label className={labelClass}>Prompt</label>
          <textarea
            className={`${inputClass} min-h-[88px] resize-y`}
            value={question.prompt}
            onChange={(e) => onUpdate({ prompt: e.target.value })}
            placeholder="What would you like to ask?"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300">
          <input
            type="checkbox"
            className="rounded border-white/20 bg-slate-900"
            checked={!!question.required}
            onChange={(e) => onUpdate({ required: e.target.checked })}
          />
          Required
        </label>
        {question.type !== "short" ? (
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              className="rounded border-white/20 bg-slate-900"
              checked={!!question.allowOther}
              onChange={(e) => onUpdate({ allowOther: e.target.checked })}
            />
            Allow &quot;Other&quot; with text field
          </label>
        ) : null}
      </div>

      {question.type !== "short" ? (
        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
              Options ({question.options?.length ?? 0})
            </p>
            <button
              type="button"
              onClick={onAddOption}
              className="rounded-lg border border-cyan-300/25 px-3 py-1.5 text-xs font-bold text-cyan-200 transition hover:bg-cyan-500/10"
            >
              + Add option
            </button>
          </div>
          <div className="space-y-2 lg:max-h-none lg:overflow-visible">
            {(question.options || []).map((option, optionIndex) => (
              <div
                key={`opt-${index}-${optionIndex}`}
                className="grid gap-2 rounded-xl border border-white/5 bg-slate-900/40 p-3 sm:grid-cols-[1fr_1fr_auto]"
              >
                <div>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Label
                  </span>
                  <input
                    className={inputClass}
                    placeholder="Label"
                    value={option.label}
                    onChange={(e) =>
                      onUpdateOption(optionIndex, { label: e.target.value })
                    }
                    onBlur={(e) =>
                      handleOptionLabelBlur(optionIndex, e.target.value)
                    }
                  />
                </div>
                <div>
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Value ID
                  </span>
                  <input
                    className={inputClass}
                    placeholder="ID"
                    value={option.id}
                    onChange={(e) =>
                      onUpdateOption(optionIndex, {
                        id: slugifySurveyId(e.target.value),
                      })
                    }
                  />
                </div>
                <div className="flex items-end sm:pb-0.5">
                  <button
                    type="button"
                    onClick={() => onRemoveOption(optionIndex)}
                    className="w-full rounded-lg border border-white/10 px-3 py-2.5 text-xs font-semibold text-slate-400 transition hover:border-red-400/30 hover:text-red-200 sm:w-auto"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
