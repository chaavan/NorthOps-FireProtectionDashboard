import {
  formatSurveyTagline,
  parseSurveyQuestions,
  SURVEY_PREFACE_HEADING,
  SURVEY_PREFACE_MESSAGE,
  SURVEY_QUESTIONS,
  SURVEY_TITLE,
  type SurveyQuestion,
  type SurveyQuestionOption,
} from "@/lib/survey/surveyQuestions";

const MAX_QUESTIONS = 30;
const MAX_OPTIONS = 20;
const MAX_PROMPT_LENGTH = 500;
const MAX_LABEL_LENGTH = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_TAGLINE_LENGTH = 120;
const MAX_PREFACE_HEADING_LENGTH = 200;
const MAX_PREFACE_MESSAGE_LENGTH = 4000;
const ID_PATTERN = /^[a-z0-9_]+$/;

export type SurveyPresentationInput = {
  title: string;
  tagline: string | null;
  prefaceHeading: string | null;
  prefaceMessage: string | null;
};

export type SurveyBuilderPayload = SurveyPresentationInput & {
  questions: SurveyQuestion[];
};

export type SurveyBuilderValidationResult =
  | { ok: true; data: SurveyBuilderPayload }
  | { ok: false; error: string };

export function slugifySurveyId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_")
    .slice(0, 64);
}

export function defaultSurveyPresentation(questionCount = SURVEY_QUESTIONS.length): SurveyPresentationInput {
  return {
    title: SURVEY_TITLE,
    tagline: formatSurveyTagline(questionCount),
    prefaceHeading: SURVEY_PREFACE_HEADING,
    prefaceMessage: SURVEY_PREFACE_MESSAGE,
  };
}

export function defaultSurveyBuilderPayload(): SurveyBuilderPayload {
  return {
    ...defaultSurveyPresentation(),
    questions: structuredClone(SURVEY_QUESTIONS),
  };
}

function trimOrNull(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeOption(raw: unknown, usedIds: Set<string>, index: number): SurveyQuestionOption | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const label = typeof item.label === "string" ? item.label.trim().slice(0, MAX_LABEL_LENGTH) : "";
  if (!label) return null;

  let id = typeof item.id === "string" ? slugifySurveyId(item.id) : "";
  if (!id) id = slugifySurveyId(label) || `option_${index + 1}`;
  let suffix = 1;
  const base = id;
  while (usedIds.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  usedIds.add(id);
  return { id, label };
}

function normalizeQuestion(raw: unknown, usedQuestionIds: Set<string>, index: number): SurveyQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim().slice(0, MAX_PROMPT_LENGTH) : "";
  const type = item.type;
  if (!prompt || (type !== "single" && type !== "multi" && type !== "short")) return null;

  let id = typeof item.id === "string" ? slugifySurveyId(item.id) : "";
  if (!id) id = slugifySurveyId(prompt) || `question_${index + 1}`;
  let suffix = 1;
  const base = id;
  while (usedQuestionIds.has(id)) {
    id = `${base}_${suffix}`;
    suffix += 1;
  }
  usedQuestionIds.add(id);

  const required = item.required === true;
  const allowOther = type === "short" ? false : item.allowOther === true;

  if (type === "short") {
    return { id, prompt, type, required };
  }

  const optionIds = new Set<string>();
  const rawOptions = Array.isArray(item.options) ? item.options : [];
  const options = rawOptions
    .map((option, optionIndex) => normalizeOption(option, optionIds, optionIndex))
    .filter((option): option is SurveyQuestionOption => option !== null);

  return {
    id,
    prompt,
    type,
    required,
    allowOther,
    options,
  };
}

export function normalizeSurveyBuilderInput(body: unknown): SurveyBuilderPayload {
  const input = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const usedQuestionIds = new Set<string>();
  const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
  const questions = rawQuestions
    .map((question, index) => normalizeQuestion(question, usedQuestionIds, index))
    .filter((question): question is SurveyQuestion => question !== null);

  const title =
    typeof input.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, MAX_TITLE_LENGTH)
      : SURVEY_TITLE;

  return {
    title,
    tagline: trimOrNull(input.tagline, MAX_TAGLINE_LENGTH),
    prefaceHeading: trimOrNull(input.prefaceHeading, MAX_PREFACE_HEADING_LENGTH),
    prefaceMessage: trimOrNull(input.prefaceMessage, MAX_PREFACE_MESSAGE_LENGTH),
    questions,
  };
}

export function validateSurveyBuilderPayload(
  payload: SurveyBuilderPayload,
  options?: { requireQuestionsForLaunch?: boolean },
): SurveyBuilderValidationResult {
  if (!payload.title.trim()) {
    return { ok: false, error: "Survey title is required." };
  }

  const questions = parseSurveyQuestions(payload.questions);
  if (options?.requireQuestionsForLaunch && questions.length === 0) {
    return { ok: false, error: "Add at least one question before launching." };
  }

  if (questions.length > MAX_QUESTIONS) {
    return { ok: false, error: `Surveys can have at most ${MAX_QUESTIONS} questions.` };
  }

  const questionIds = new Set<string>();
  for (const question of questions) {
    if (!ID_PATTERN.test(question.id)) {
      return {
        ok: false,
        error: `Question id "${question.id}" must use lowercase letters, numbers, and underscores only.`,
      };
    }
    if (questionIds.has(question.id)) {
      return { ok: false, error: `Duplicate question id "${question.id}".` };
    }
    questionIds.add(question.id);

    if (question.type === "short") continue;

    const optionList = question.options || [];
    if (optionList.length < 2) {
      return {
        ok: false,
        error: `"${question.prompt}" needs at least two answer options.`,
      };
    }
    if (optionList.length > MAX_OPTIONS) {
      return {
        ok: false,
        error: `"${question.prompt}" can have at most ${MAX_OPTIONS} options.`,
      };
    }

    const optionIds = new Set<string>();
    for (const option of optionList) {
      if (!ID_PATTERN.test(option.id)) {
        return {
          ok: false,
          error: `Option id "${option.id}" must use lowercase letters, numbers, and underscores only.`,
        };
      }
      if (!option.label.trim()) {
        return { ok: false, error: `Every option needs a label in "${question.prompt}".` };
      }
      if (optionIds.has(option.id)) {
        return { ok: false, error: `Duplicate option id "${option.id}" in "${question.prompt}".` };
      }
      optionIds.add(option.id);
    }
  }

  return {
    ok: true,
    data: {
      title: payload.title.trim(),
      tagline: payload.tagline,
      prefaceHeading: payload.prefaceHeading,
      prefaceMessage: payload.prefaceMessage,
      questions,
    },
  };
}

export function resolveSurveyPresentation(
  survey: {
    title?: string;
    tagline?: string | null;
    prefaceHeading?: string | null;
    prefaceMessage?: string | null;
    questions?: unknown;
  },
  fallbacks?: SurveyPresentationInput,
): SurveyPresentationInput & { tagline: string } {
  const fb = fallbacks || defaultSurveyPresentation(parseSurveyQuestions(survey.questions).length);
  const questionCount = parseSurveyQuestions(survey.questions).length;
  return {
    title: survey.title?.trim() || fb.title,
    tagline:
      survey.tagline?.trim() ||
      fb.tagline ||
      formatSurveyTagline(questionCount),
    prefaceHeading: survey.prefaceHeading?.trim() || fb.prefaceHeading || SURVEY_PREFACE_HEADING,
    prefaceMessage: survey.prefaceMessage?.trim() || fb.prefaceMessage || SURVEY_PREFACE_MESSAGE,
  };
}
