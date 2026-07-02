import { isDeveloperEmail } from "@/lib/auth";
import {
  getOptionLabel,
  SurveyAnswerValue,
  SurveyAnswers,
  SurveyDraftProgress,
  SurveyQuestion,
} from "@/lib/survey/surveyQuestions";

type SurveyLike = {
  id: string;
  version: number;
  title: string;
  status: string;
  questions: unknown;
  createdAt: Date;
  closedAt?: Date | null;
};

type SurveyResponseLike = {
  id: string;
  surveyId: string;
  userId: string;
  userEmail: string;
  userName?: string | null;
  department?: string | null;
  answers: unknown;
  status?: string;
  submittedAt: Date | null;
  updatedAt?: Date;
};

type SurveyUserLike = {
  id: string;
  name?: string | null;
  email: string;
  role?: string | null;
};

export type SurveyValidationResult =
  | { ok: true; answers: SurveyAnswers; department: string | null }
  | { ok: false; error: string };

export type SurveyResultsPayload = ReturnType<typeof buildSurveyResultsPayload>;

function asQuestions(raw: unknown): SurveyQuestion[] {
  return Array.isArray(raw) ? (raw as SurveyQuestion[]) : [];
}

function asAnswers(raw: unknown): SurveyAnswers {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as SurveyAnswers)
    : {};
}

function responseStatus(response: SurveyResponseLike): "COMPLETE" | "INCOMPLETE" {
  if (response.status === "COMPLETE" || response.status === "INCOMPLETE") {
    return response.status;
  }
  return response.submittedAt ? "COMPLETE" : "INCOMPLETE";
}

function selectedValues(value: SurveyAnswerValue | undefined): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.selected)) return value.selected;
  return [value.selected];
}

function otherText(value: SurveyAnswerValue | undefined): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return typeof value.other === "string" ? value.other.trim() : "";
}

function compactUnique(values: unknown[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

function validateChoiceAnswer(
  question: SurveyQuestion,
  rawValue: unknown,
  options?: { partial?: boolean },
): { ok: true; value: SurveyAnswerValue } | { ok: false; error: string } {
  const partial = options?.partial === true;
  const optionIds = new Set(question.options?.map((option) => option.id) || []);
  const allowOther = !!question.allowOther;
  const allowed = (value: string) => optionIds.has(value) || (allowOther && value === "other");

  if (question.type === "single") {
    const selected =
      typeof rawValue === "string"
        ? rawValue.trim()
        : rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
          ? typeof (rawValue as { selected?: unknown }).selected === "string"
            ? ((rawValue as { selected: string }).selected || "").trim()
            : ""
          : "";
    const other =
      rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
        ? typeof (rawValue as { other?: unknown }).other === "string"
          ? ((rawValue as { other: string }).other || "").trim()
          : ""
        : "";

    if (!selected) {
      if (partial) return { ok: false, error: "__empty__" };
      if (question.required) {
        return { ok: false, error: `${question.prompt} is required.` };
      }
      return { ok: true, value: "" };
    }
    if (selected && !allowed(selected)) {
      return { ok: false, error: `Invalid answer for ${question.prompt}.` };
    }
    if (selected === "other" && !other) {
      return { ok: false, error: `Please fill in Other for ${question.prompt}.` };
    }
    return { ok: true, value: selected === "other" ? { selected, other } : selected };
  }

  const rawSelected =
    Array.isArray(rawValue)
      ? rawValue
      : rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
        ? (rawValue as { selected?: unknown }).selected
        : [];
  const selected = compactUnique(Array.isArray(rawSelected) ? rawSelected : []);
  const other =
    rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? typeof (rawValue as { other?: unknown }).other === "string"
        ? ((rawValue as { other: string }).other || "").trim()
        : ""
      : "";

  if (selected.length === 0) {
    if (partial) return { ok: false, error: "__empty__" };
    if (question.required) {
      return { ok: false, error: `${question.prompt} is required.` };
    }
    return { ok: true, value: [] };
  }
  if (selected.some((value) => !allowed(value))) {
    return { ok: false, error: `Invalid answer for ${question.prompt}.` };
  }
  if (selected.includes("other") && !other) {
    return { ok: false, error: `Please fill in Other for ${question.prompt}.` };
  }
  return { ok: true, value: selected.includes("other") ? { selected, other } : selected };
}

export function parseSurveyProgress(raw: unknown): SurveyDraftProgress | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const currentIndex =
    typeof value.currentIndex === "number" && Number.isFinite(value.currentIndex)
      ? Math.max(0, Math.floor(value.currentIndex))
      : 0;
  const showPreface =
    value.showPreface === true
      ? true
      : value.showPreface === false
        ? false
        : true;
  return { currentIndex, showPreface };
}

export function validatePartialSurveyAnswers(
  questionsRaw: unknown,
  rawAnswers: unknown,
): SurveyValidationResult {
  const questions = asQuestions(questionsRaw);
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const input = asAnswers(rawAnswers);
  const answers: SurveyAnswers = {};

  for (const [questionId, rawValue] of Object.entries(input)) {
    const question = questionById.get(questionId);
    if (!question) continue;

    if (question.type === "short") {
      const value = typeof rawValue === "string" ? rawValue.trim().slice(0, 3000) : "";
      if (!value) continue;
      answers[question.id] = value;
      continue;
    }

    const result = validateChoiceAnswer(question, rawValue, { partial: true });
    if (!result.ok) {
      if (result.error === "__empty__") continue;
      return result;
    }
    answers[question.id] = result.value;
  }

  return {
    ok: true,
    answers,
    department: displayAnswer(
      questions.find((question) => question.id === "department"),
      answers.department,
    ),
  };
}

export function validateSurveyAnswers(
  questionsRaw: unknown,
  rawAnswers: unknown,
): SurveyValidationResult {
  const questions = asQuestions(questionsRaw);
  const input = asAnswers(rawAnswers);
  const answers: SurveyAnswers = {};

  for (const question of questions) {
    const rawValue = input[question.id];
    if (question.type === "short") {
      const value = typeof rawValue === "string" ? rawValue.trim().slice(0, 3000) : "";
      if (question.required && !value) {
        return { ok: false, error: `${question.prompt} is required.` };
      }
      answers[question.id] = value;
      continue;
    }

    const result = validateChoiceAnswer(question, rawValue);
    if (!result.ok) return result;
    answers[question.id] = result.value;
  }

  return {
    ok: true,
    answers,
    department: displayAnswer(
      questions.find((question) => question.id === "department"),
      answers.department,
    ),
  };
}

export function displayAnswer(
  question: SurveyQuestion | undefined,
  value: SurveyAnswerValue | undefined,
): string {
  if (!question || value === undefined || value === null) return "";
  if (question.type === "short") return typeof value === "string" ? value : "";

  const selections = selectedValues(value);
  return selections
    .map((selection) => {
      if (selection === "other") {
        const other = otherText(value);
        return other ? `Other: ${other}` : "Other";
      }
      return getOptionLabel(question, selection);
    })
    .join(", ");
}

export function buildSurveyResultsPayload(params: {
  survey: SurveyLike;
  responses: SurveyResponseLike[];
  users: SurveyUserLike[];
}) {
  const { survey, responses, users } = params;
  const questions = asQuestions(survey.questions);
  const eligibleUsers = users
    .filter((user) => !isDeveloperEmail(user.email))
    .sort((a, b) => a.email.localeCompare(b.email));
  const completeResponses = responses.filter((response) => responseStatus(response) === "COMPLETE");
  const incompleteResponses = responses.filter((response) => responseStatus(response) === "INCOMPLETE");
  const respondedUserIds = new Set(completeResponses.map((response) => response.userId));
  const inProgressUserIds = new Set(incompleteResponses.map((response) => response.userId));
  const responseCount = completeResponses.length;
  const eligibleUserCount = eligibleUsers.length;
  const responseRate = eligibleUserCount === 0 ? 0 : Math.round((responseCount / eligibleUserCount) * 1000) / 10;

  const questionResults = questions.map((question) => {
    if (question.type === "short") {
      const answers = completeResponses
        .map((response) => ({
          responseId: response.id,
          userName: response.userName,
          userEmail: response.userEmail,
          text: displayAnswer(question, asAnswers(response.answers)[question.id]),
        }))
        .filter((answer) => answer.text.trim().length > 0);
      return { ...question, answers };
    }

    const optionIds = [...(question.options?.map((option) => option.id) || [])];
    if (question.allowOther) optionIds.push("other");
    const counts = new Map(optionIds.map((id) => [id, 0]));
    const otherTexts: Array<{ responseId: string; userEmail: string; text: string }> = [];

    for (const response of completeResponses) {
      const answer = asAnswers(response.answers)[question.id];
      const selections = selectedValues(answer);
      for (const selection of selections) {
        counts.set(selection, (counts.get(selection) || 0) + 1);
      }
      const other = otherText(answer);
      if (selections.includes("other") && other) {
        otherTexts.push({ responseId: response.id, userEmail: response.userEmail, text: other });
      }
    }

    return {
      ...question,
      options: optionIds.map((id) => ({
        id,
        label: id === "other" ? "Other" : getOptionLabel(question, id),
        count: counts.get(id) || 0,
        percentage: responseCount === 0 ? 0 : Math.round(((counts.get(id) || 0) / responseCount) * 1000) / 10,
      })),
      otherTexts,
    };
  });

  const responseDetails = responses
    .slice()
    .sort((a, b) => {
      const aTime = (a.updatedAt || a.submittedAt || new Date(0)).getTime();
      const bTime = (b.updatedAt || b.submittedAt || new Date(0)).getTime();
      return aTime - bTime;
    })
    .map((response) => {
      const answers = asAnswers(response.answers);
      const isComplete = responseStatus(response) === "COMPLETE";
      return {
        id: response.id,
        userId: response.userId,
        userName: response.userName,
        userEmail: response.userEmail,
        department: response.department,
        status: isComplete ? ("COMPLETE" as const) : ("INCOMPLETE" as const),
        submittedAt: response.submittedAt?.toISOString() ?? null,
        updatedAt: response.updatedAt?.toISOString() ?? null,
        answers: questions.map((question) => ({
          questionId: question.id,
          prompt: question.prompt,
          value: displayAnswer(question, answers[question.id]),
        })),
      };
    });

  return {
    survey: {
      id: survey.id,
      version: survey.version,
      title: survey.title,
      status: survey.status,
      createdAt: survey.createdAt.toISOString(),
      closedAt: survey.closedAt?.toISOString() ?? null,
    },
    totals: {
      responseCount,
      eligibleUserCount,
      responseRate,
    },
    questions: questionResults,
    responses: responseDetails,
    completion: {
      respondedUsers: eligibleUsers
        .filter((user) => respondedUserIds.has(user.id))
        .map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role })),
      inProgressUsers: eligibleUsers
        .filter((user) => inProgressUserIds.has(user.id) && !respondedUserIds.has(user.id))
        .map((user) => {
          const response = incompleteResponses.find((entry) => entry.userId === user.id);
          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            updatedAt: response?.updatedAt?.toISOString() ?? null,
          };
        }),
      pendingUsers: eligibleUsers
        .filter((user) => !respondedUserIds.has(user.id) && !inProgressUserIds.has(user.id))
        .map((user) => ({ id: user.id, name: user.name, email: user.email, role: user.role })),
    },
  };
}
