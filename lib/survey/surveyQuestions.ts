export type SurveyQuestionType = "single" | "multi" | "short";

export type SurveyQuestionOption = {
  id: string;
  label: string;
};

export type SurveyQuestion = {
  id: string;
  prompt: string;
  type: SurveyQuestionType;
  options?: SurveyQuestionOption[];
  allowOther?: boolean;
  required?: boolean;
};

export type SurveyAnswerValue =
  | string
  | string[]
  | {
      selected: string | string[];
      other?: string;
    };

export type SurveyAnswers = Record<string, SurveyAnswerValue>;

export type SurveyDraftProgress = {
  currentIndex: number;
  showPreface: boolean;
};

export const SURVEY_TITLE = "TFP System Survey";

/** Short line under the title in the survey header (legacy default). */
export const SURVEY_TAGLINE = "About 2 minutes · 7 questions";

export function formatSurveyTagline(questionCount: number): string {
  return `About 2 minutes · ${questionCount} question${questionCount === 1 ? "" : "s"}`;
}

/** Shown on the preface screen before question 1 (user-facing). */
export const SURVEY_PREFACE_HEADING = "What this survey is for";
export const SURVEY_PREFACE_MESSAGE =
  "This form is to understand how we can better help and improve our ERP system for TFP. We appreciate your time and feedback and we're looking forward to hearing all your suggestions.";

/**
 * Internal context for developers only (Form 1) — not shown in the user popup.
 * @see app/dev/survey/page.tsx
 */
export const SURVEY_INTERNAL_PURPOSE =
  "The purpose of this form is to gauge interest within TFP and understand their daily utility in HQ. By understanding how embedded our product is in TFP's ecosystem, we can begin pricing around the leverage we have across TFP.";

/** @deprecated Use SURVEY_TAGLINE */
export const SURVEY_INTRO = SURVEY_TAGLINE;

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "department",
    prompt: "What department do you primarily work in?",
    type: "single",
    required: true,
    allowOther: true,
    options: [
      { id: "operations", label: "Operations" },
      { id: "project_management", label: "Project Management" },
      { id: "purchasing", label: "Purchasing" },
      { id: "warehouse_inventory", label: "Warehouse / Inventory" },
      { id: "accounting_finance", label: "Accounting / Finance" },
      { id: "executive_leadership", label: "Executive Leadership" },
      { id: "administration", label: "Administration" },
      { id: "sales_business_development", label: "Sales / Business Development" },
    ],
  },
  {
    id: "usage_frequency",
    prompt: "How frequently do you use the platform during a typical work week?",
    type: "single",
    required: true,
    options: [
      { id: "multiple_times_per_day", label: "Multiple times per day" },
      { id: "once_per_day", label: "Once per day" },
      { id: "several_times_per_week", label: "Several times per week" },
      { id: "once_per_week", label: "Once per week" },
      { id: "less_than_once_per_week", label: "Less than once per week" },
      { id: "do_not_use", label: "I do not currently use it" },
    ],
  },
  {
    id: "useful_areas",
    prompt:
      "Which areas of the platform do you find most useful in your day-to-day work? HOw many times a week do you use platform** iterate",
    type: "multi",
    required: true,
    allowOther: true,
    options: [
      { id: "job_tracking", label: "Job Tracking" },
      { id: "purchasing", label: "Purchasing" },
      { id: "delivery_scheduling", label: "Delivery Scheduling" },
      { id: "inventory_management", label: "Inventory Management" },
      { id: "reporting", label: "Reporting" },
      { id: "project_coordination", label: "Project Coordination" },
      { id: "documentation", label: "Documentation" },
      { id: "status_macro_visibility", label: "Status/Macro Visibility" },
    ],
  },
  {
    id: "overall_experience",
    prompt: "How would you rate your overall experience with the platform so far?",
    type: "single",
    required: true,
    options: [
      { id: "excellent", label: "Excellent" },
      { id: "good", label: "Good" },
      { id: "neutral", label: "Neutral" },
      { id: "needs_improvement", label: "Needs Improvement" },
      { id: "poor", label: "Poor" },
    ],
  },
  {
    id: "easier_workflows",
    prompt:
      "Are there any tasks or workflows that have become easier since using the platform? If so, please describe them.",
    type: "short",
    required: false,
  },
  {
    id: "one_improvement",
    prompt: "If you could improve one thing about the platform, what would it be?",
    type: "short",
    required: false,
  },
  {
    id: "additional_features",
    prompt:
      "What additional features, reports, or capabilities would make the platform more valuable for you or your team?",
    type: "short",
    required: false,
  },
];

export function getOptionLabel(question: SurveyQuestion, optionId: string): string {
  return question.options?.find((option) => option.id === optionId)?.label || optionId;
}

export function isOtherSelection(value: string | string[]): boolean {
  return Array.isArray(value) ? value.includes("other") : value === "other";
}

/** Normalize Prisma JSON into a safe question list for the popup UI. */
export function parseSurveyQuestions(value: unknown): SurveyQuestion[] {
  if (!value) return [];

  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is SurveyQuestion => {
    if (!item || typeof item !== "object") return false;
    const question = item as SurveyQuestion;
    return (
      typeof question.id === "string" &&
      question.id.length > 0 &&
      typeof question.prompt === "string" &&
      question.prompt.length > 0 &&
      (question.type === "single" ||
        question.type === "multi" ||
        question.type === "short")
    );
  });
}
