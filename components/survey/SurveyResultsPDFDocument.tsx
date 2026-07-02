import React from "react";
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

type Results = {
  survey: {
    title: string;
    version: number;
    status: string;
    createdAt: string;
    closedAt: string | null;
  };
  totals: {
    responseCount: number;
    eligibleUserCount: number;
    responseRate: number;
  };
  questions: Array<{
    id: string;
    prompt: string;
    type: "single" | "multi" | "short";
    options?: Array<{ id: string; label: string; count?: number; percentage?: number }>;
    answers?: Array<{ responseId: string; userName?: string | null; userEmail: string; text: string }>;
    otherTexts?: Array<{ responseId: string; userEmail: string; text: string }>;
  }>;
  responses: Array<{
    id: string;
    userName?: string | null;
    userEmail: string;
    department?: string | null;
    status?: "COMPLETE" | "INCOMPLETE";
    submittedAt: string | null;
    updatedAt?: string | null;
    answers: Array<{ questionId: string; prompt: string; value: string }>;
  }>;
  completion: {
    respondedUsers: Array<{ id: string; name?: string | null; email: string }>;
    inProgressUsers?: Array<{
      id: string;
      name?: string | null;
      email: string;
      updatedAt?: string | null;
    }>;
    pendingUsers: Array<{ id: string; name?: string | null; email: string }>;
  };
};

type Props = {
  results: Results;
  generatedAtDisplay: string;
};

const BRAND_NAVY = "#0c2742";
const BRAND_BLUE = "#1e6fe8";
const BORDER = "#d7e0ea";
const LIGHT_BG = "#f3f6fa";
const MUTED = "#5c6b7a";

const styles = StyleSheet.create({
  page: {
    paddingTop: 46,
    paddingBottom: 38,
    paddingHorizontal: 34,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#111827",
  },
  title: { color: BRAND_NAVY, fontSize: 22, fontWeight: 700, marginBottom: 4 },
  subtitle: { color: MUTED, fontSize: 9, marginBottom: 14 },
  grid: { flexDirection: "row", gap: 10, marginBottom: 14 },
  stat: { flex: 1, borderWidth: 1, borderColor: BORDER, backgroundColor: LIGHT_BG, padding: 10 },
  statLabel: { color: MUTED, fontSize: 7, textTransform: "uppercase", marginBottom: 4 },
  statValue: { color: BRAND_NAVY, fontSize: 16, fontWeight: 700 },
  sectionTitle: {
    marginTop: 10,
    marginBottom: 7,
    color: BRAND_NAVY,
    fontSize: 13,
    fontWeight: 700,
  },
  panel: { borderWidth: 1, borderColor: BORDER, padding: 9, marginBottom: 9 },
  prompt: { fontSize: 10, fontWeight: 700, color: BRAND_NAVY, marginBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  label: { width: "38%", fontSize: 8 },
  barWrap: { width: "42%", height: 7, backgroundColor: "#e5edf6", marginRight: 8 },
  bar: { height: 7, backgroundColor: BRAND_BLUE },
  count: { width: "20%", fontSize: 8, color: MUTED, textAlign: "right" },
  textAnswer: { borderTopWidth: 1, borderTopColor: BORDER, paddingTop: 5, marginTop: 5 },
  textMeta: { color: MUTED, fontSize: 7, marginBottom: 2 },
  textBody: { fontSize: 8, lineHeight: 1.35 },
  responseCard: { borderWidth: 1, borderColor: BORDER, padding: 9, marginBottom: 9 },
  responseHeader: { color: BRAND_NAVY, fontSize: 11, fontWeight: 700, marginBottom: 4 },
  qaPrompt: { color: MUTED, fontSize: 7, textTransform: "uppercase", marginTop: 5, marginBottom: 1 },
  qaAnswer: { fontSize: 8, lineHeight: 1.3 },
});

function formatDate(value: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default function SurveyResultsPDFDocument({ results, generatedAtDisplay }: Props) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>{results.survey.title}</Text>
        <Text style={styles.subtitle}>
          Round {results.survey.version} · {results.survey.status} · Generated {generatedAtDisplay}
        </Text>

        <View style={styles.grid}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Responses</Text>
            <Text style={styles.statValue}>{results.totals.responseCount}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Eligible users</Text>
            <Text style={styles.statValue}>{results.totals.eligibleUserCount}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Response rate</Text>
            <Text style={styles.statValue}>{results.totals.responseRate}%</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Created</Text>
            <Text style={styles.statValue}>{formatDate(results.survey.createdAt)}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Closed</Text>
            <Text style={styles.statValue}>{formatDate(results.survey.closedAt)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Completion</Text>
        <View style={styles.grid}>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Completed</Text>
            <Text style={styles.statValue}>{results.completion.respondedUsers.length}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>In progress</Text>
            <Text style={styles.statValue}>{results.completion.inProgressUsers?.length || 0}</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statLabel}>Not started</Text>
            <Text style={styles.statValue}>{results.completion.pendingUsers.length}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Summary by Question</Text>
        {results.questions.map((question) => (
          <View key={question.id} style={styles.panel} wrap={false}>
            <Text style={styles.prompt}>{question.prompt}</Text>
            {question.type === "short" ? (
              question.answers?.length ? (
                question.answers.slice(0, 8).map((answer) => (
                  <View key={answer.responseId} style={styles.textAnswer}>
                    <Text style={styles.textMeta}>{answer.userName || answer.userEmail}</Text>
                    <Text style={styles.textBody}>{answer.text}</Text>
                  </View>
                ))
              ) : (
                <Text style={styles.textBody}>No written responses.</Text>
              )
            ) : (
              question.options?.map((option) => (
                <View key={option.id} style={styles.row}>
                  <Text style={styles.label}>{option.label}</Text>
                  <View style={styles.barWrap}>
                    <View style={[styles.bar, { width: `${Math.min(100, option.percentage || 0)}%` }]} />
                  </View>
                  <Text style={styles.count}>
                    {option.count || 0} ({option.percentage || 0}%)
                  </Text>
                </View>
              ))
            )}
          </View>
        ))}
      </Page>

      <Page size="LETTER" style={styles.page}>
        <Text style={styles.title}>Individual Response Appendix</Text>
        <Text style={styles.subtitle}>
          {results.responses.length} saved responses ({results.totals.responseCount} complete). Not started:{" "}
          {results.completion.pendingUsers.length}.
        </Text>
        {results.responses.map((response) => (
          <View key={response.id} style={styles.responseCard} wrap={false}>
            <Text style={styles.responseHeader}>
              {response.userName || response.userEmail} ·{" "}
              {response.status === "INCOMPLETE" ? "Draft" : "Complete"}
            </Text>
            <Text style={styles.subtitle}>
              {response.userEmail} · {response.department || "No department"} ·{" "}
              {response.status === "COMPLETE"
                ? formatDate(response.submittedAt)
                : `Last saved ${formatDate(response.updatedAt ?? null)}`}
            </Text>
            {response.answers.map((answer) => (
              <View key={answer.questionId}>
                <Text style={styles.qaPrompt}>{answer.prompt}</Text>
                <Text style={styles.qaAnswer}>{answer.value || "No answer"}</Text>
              </View>
            ))}
          </View>
        ))}
      </Page>
    </Document>
  );
}
