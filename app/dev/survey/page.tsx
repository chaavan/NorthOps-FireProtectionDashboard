"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardSidebar from "@/components/DashboardSidebar";
import AccessDeniedOverlay from "@/components/AccessDeniedOverlay";
import { usePermissions } from "@/lib/hooks/usePermissions";
import DevSurveyIndividualResponse from "@/components/survey/DevSurveyIndividualResponse";
import DevSurveyPersonPicker from "@/components/survey/DevSurveyPersonPicker";
import DevSurveyQuestionOverview from "@/components/survey/DevSurveyQuestionOverview";

type ResultsTab = "overview" | "individual";

type SurveyRound = {
  id: string;
  version: number;
  title: string;
  status: string;
  createdAt: string;
  closedAt: string | null;
  responseCount: number;
  eligibleUserCount: number;
  responseRate: number;
};

type ChoiceResult = {
  id: string;
  label: string;
  count: number;
  percentage: number;
};

type QuestionResult = {
  id: string;
  prompt: string;
  type: "single" | "multi" | "short";
  options?: ChoiceResult[];
  answers?: Array<{ responseId: string; userName?: string | null; userEmail: string; text: string }>;
  otherTexts?: Array<{ responseId: string; userEmail: string; text: string }>;
};

type SurveyResults = {
  survey: SurveyRound & { id: string };
  totals: {
    responseCount: number;
    eligibleUserCount: number;
    responseRate: number;
  };
  questions: QuestionResult[];
  responses: Array<{
    id: string;
    userId: string;
    userName?: string | null;
    userEmail: string;
    department?: string | null;
    status: "COMPLETE" | "INCOMPLETE";
    submittedAt: string | null;
    updatedAt: string | null;
    answers: Array<{ questionId: string; prompt: string; value: string }>;
  }>;
  completion: {
    respondedUsers: Array<{ id: string; name?: string | null; email: string; role?: string | null }>;
    inProgressUsers: Array<{
      id: string;
      name?: string | null;
      email: string;
      role?: string | null;
      updatedAt: string | null;
    }>;
    pendingUsers: Array<{ id: string; name?: string | null; email: string; role?: string | null }>;
  };
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="h-full w-full rounded-3xl border border-white/10 bg-white/10 p-5 shadow-xl backdrop-blur">
      <p className="text-xs font-bold uppercase tracking-[0.28em] text-cyan-200">{label}</p>
      <p className="mt-3 text-4xl font-black text-white">{value}</p>
      {sub ? <p className="mt-2 text-sm text-slate-300">{sub}</p> : null}
    </div>
  );
}

function CompletionUserRow({
  name,
  email,
  sub,
  onClick,
}: {
  name: string;
  email: string;
  sub?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2 text-left transition hover:border-cyan-300/30 hover:bg-white/5"
    >
      <p className="text-sm font-semibold text-white">{name}</p>
      <p className="text-xs text-slate-400">{email}</p>
      {sub ? <p className="mt-1 text-[10px] text-slate-500">{sub}</p> : null}
    </button>
  );
}

function DevSurveyPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roundFromQuery = searchParams?.get("round");
  const tabFromQuery = searchParams?.get("tab");
  const userFromQuery = searchParams?.get("user");
  const { data: session, status } = useSession();
  const { isDeveloper, hasPermission, isLoading: permissionsLoading } = usePermissions();
  const canAccessSurveyAdmin = isDeveloper || hasPermission("dev.survey.view");
  const [rounds, setRounds] = useState<SurveyRound[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [results, setResults] = useState<SurveyResults | null>(null);
  const [resultsRoundId, setResultsRoundId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ResultsTab>(
    tabFromQuery === "individual" ? "individual" : "overview",
  );
  const [selectedUserId, setSelectedUserId] = useState<string | null>(userFromQuery ?? null);
  const [isLoading, setIsLoading] = useState(true);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveSelectedRoundId = useCallback(
    (loadedRounds: SurveyRound[], preferredId?: string | null) => {
      if (preferredId && loadedRounds.some((round) => round.id === preferredId)) {
        return preferredId;
      }
      return loadedRounds[0]?.id || "";
    },
    [],
  );

  const loadRounds = useCallback(
    async (options?: { preserveSelection?: boolean; currentId?: string }) => {
      const response = await fetch("/api/dev/survey", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to load survey rounds");
      const loadedRounds = (data.surveys || []) as SurveyRound[];
      setRounds(loadedRounds);
      const preferredId = options?.preserveSelection
        ? options.currentId || roundFromQuery
        : roundFromQuery;
      const nextId = resolveSelectedRoundId(loadedRounds, preferredId);
      setSelectedId(nextId);
      return { loadedRounds, selectedId: nextId };
    },
    [resolveSelectedRoundId, roundFromQuery],
  );

  const loadResults = useCallback(async (surveyId: string) => {
    if (!surveyId) {
      setResults(null);
      setResultsRoundId(null);
      return;
    }
    setIsResultsLoading(true);
    try {
      const response = await fetch(`/api/dev/survey/${encodeURIComponent(surveyId)}/results`, {
        cache: "no-store",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to load results");
      setResults(data as SurveyResults);
      setResultsRoundId(surveyId);
    } finally {
      setIsResultsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/login?callbackUrl=/dev/survey");
      return;
    }
    if (!canAccessSurveyAdmin) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        setIsLoading(true);
        setError(null);
        await loadRounds();
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
  }, [canAccessSurveyAdmin, loadResults, loadRounds, router, session, status]);

  useEffect(() => {
    if (!selectedId || !canAccessSurveyAdmin || isLoading) return;
    if (resultsRoundId === selectedId) return;

    let cancelled = false;
    const load = async () => {
      try {
        setError(null);
        await loadResults(selectedId);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [canAccessSurveyAdmin, isLoading, loadResults, resultsRoundId, selectedId]);

  useEffect(() => {
    if (!roundFromQuery || rounds.length === 0) return;
    if (roundFromQuery === selectedId) return;
    if (!rounds.some((round) => round.id === roundFromQuery)) return;
    setSelectedId(roundFromQuery);
    setSelectedUserId(null);
  }, [roundFromQuery, rounds, selectedId]);

  const roundResults = useMemo(() => {
    if (!results || results.survey.id !== selectedId) return null;
    return results;
  }, [results, selectedId]);

  const respondents = useMemo(
    () =>
      (roundResults?.responses || []).map((response) => ({
        userId: response.userId,
        userName: response.userName,
        userEmail: response.userEmail,
        department: response.department,
        status: response.status,
      })),
    [roundResults?.responses],
  );

  const selectedResponse = useMemo(
    () => roundResults?.responses.find((response) => response.userId === selectedUserId) || null,
    [roundResults?.responses, selectedUserId],
  );

  useEffect(() => {
    if (!roundResults) return;
    if (roundFromQuery && roundFromQuery !== selectedId) return;

    if (userFromQuery) {
      const exists = roundResults.responses.some((response) => response.userId === userFromQuery);
      if (exists) {
        setSelectedUserId(userFromQuery);
        if (tabFromQuery === "individual") setActiveTab("individual");
        return;
      }
      setSelectedUserId(null);
    }

    if (tabFromQuery === "individual" && tabFromQuery !== activeTab) {
      setActiveTab("individual");
    }
  }, [activeTab, roundFromQuery, roundResults, selectedId, tabFromQuery, userFromQuery]);

  useEffect(() => {
    if (!roundResults || !selectedUserId) return;
    const exists = roundResults.responses.some((response) => response.userId === selectedUserId);
    if (!exists) setSelectedUserId(null);
  }, [roundResults, selectedUserId]);

  const handleRoundChange = useCallback(
    (roundId: string) => {
      setSelectedId(roundId);
      setSelectedUserId(null);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("round", roundId);
      params.delete("user");
      if (activeTab === "individual") {
        params.set("tab", "individual");
      } else {
        params.delete("tab");
      }
      router.replace(`/dev/survey?${params.toString()}`, { scroll: false });
    },
    [activeTab, router, searchParams],
  );

  const openIndividualForUser = useCallback(
    (userId: string) => {
      setSelectedUserId(userId);
      setActiveTab("individual");
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", "individual");
      params.set("user", userId);
      if (selectedId) params.set("round", selectedId);
      router.replace(`/dev/survey?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, selectedId],
  );

  const setResultsTab = useCallback(
    (tab: ResultsTab) => {
      setActiveTab(tab);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", tab);
      if (tab === "overview") {
        params.delete("user");
      } else if (selectedUserId) {
        params.set("user", selectedUserId);
      }
      if (selectedId) params.set("round", selectedId);
      router.replace(`/dev/survey?${params.toString()}`, { scroll: false });
    },
    [router, searchParams, selectedId, selectedUserId],
  );

  const selectedRound = useMemo(
    () => rounds.find((round) => round.id === selectedId) || null,
    [rounds, selectedId],
  );

  const launchRound = async () => {
    if (
      !selectedId ||
      !window.confirm(
        "Launch this survey round? Eligible users will see the survey popup, and any currently active round will be closed.",
      )
    ) {
      return;
    }
    try {
      setIsWorking(true);
      setError(null);
      const response = await fetch(`/api/dev/survey/${encodeURIComponent(selectedId)}/launch`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to launch survey");
      await loadRounds({ preserveSelection: true, currentId: selectedId });
      await loadResults(selectedId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsWorking(false);
    }
  };

  const closeRound = async () => {
    if (!selectedId || !window.confirm("Close this survey round?")) return;
    try {
      setIsWorking(true);
      setError(null);
      const response = await fetch(`/api/dev/survey/${encodeURIComponent(selectedId)}/close`, {
        method: "POST",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || "Failed to close survey");
      await loadRounds({ preserveSelection: true, currentId: selectedId });
      await loadResults(selectedId);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsWorking(false);
    }
  };

  const roundStatus = selectedRound?.status ?? roundResults?.survey.status;
  const isDraftRound = roundStatus === "DRAFT";
  const isClosedRound = roundStatus === "CLOSED";

  const downloadPdf = () => {
    if (!selectedId) return;
    window.open(`/api/dev/survey/${encodeURIComponent(selectedId)}/pdf`, "_blank", "noopener,noreferrer");
  };

  if (status === "loading" || permissionsLoading || isLoading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">Loading survey dashboard...</div>;
  }

  if (!canAccessSurveyAdmin) {
    return (
      <div className="flex min-h-screen bg-slate-950 text-white">
        <DashboardSidebar />
        <main className="pointer-events-none flex flex-1 select-none flex-col gap-4 p-6 blur-sm opacity-60">
          <div className="h-32 rounded-3xl border border-white/10 bg-white/10" />
          <div className="grid flex-1 gap-4 lg:grid-cols-3">
            <div className="rounded-3xl border border-white/10 bg-white/10" />
            <div className="rounded-3xl border border-white/10 bg-white/10 lg:col-span-2" />
          </div>
        </main>
        <AccessDeniedOverlay message="Developer access is required to view the survey dashboard." />
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full min-h-0 overflow-hidden bg-slate-950 text-white">
      <DashboardSidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="relative flex min-h-full w-full max-w-none flex-1 flex-col p-4 sm:p-5 lg:px-6 lg:py-6">
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute left-1/4 top-0 h-80 w-80 rounded-full bg-blue-500/20 blur-3xl" />
            <div className="absolute bottom-10 right-10 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
          </div>

          <div className="relative flex w-full max-w-none flex-1 flex-col min-h-0">
            <div className="mb-6 flex shrink-0 flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.35em] text-cyan-200">Developer dashboard</p>
                <div className="mt-2 flex flex-wrap items-end gap-x-2 gap-y-2">
                  <h1 className="shrink-0 text-2xl font-black tracking-tight sm:text-3xl lg:text-4xl">
                    TFP System Survey
                  </h1>
                  <div className="mb-0.5 flex shrink-0 flex-col">
                    <label
                      htmlFor="survey-round-select"
                      className="mb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500"
                    >
                      Survey round
                    </label>
                    <select
                      id="survey-round-select"
                      value={selectedId}
                      onChange={(event) => handleRoundChange(event.target.value)}
                      className="w-auto min-w-[10.5rem] max-w-[14rem] rounded-lg border border-white/15 bg-slate-900/90 px-3 py-1.5 text-sm text-white outline-none focus:border-cyan-300"
                    >
                      {rounds.length === 0 ? <option value="">No rounds yet</option> : null}
                      {rounds.map((round) => (
                        <option key={round.id} value={round.id}>
                          R{round.version} · {round.status} · {round.responseCount}/{round.eligibleUserCount}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <p className="mt-2 text-sm text-slate-400">
                  Create and launch rounds, monitor responses, and export results.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Link
                  href="/dev/survey/new"
                  className="rounded-xl bg-gradient-to-r from-cyan-300 to-blue-500 px-5 py-2.5 text-sm font-black text-slate-950 shadow-lg transition hover:scale-[1.02]"
                >
                  New survey
                </Link>
                {selectedRound?.status === "DRAFT" ? (
                  <Link
                    href={`/dev/survey/${selectedId}/edit`}
                    className="rounded-xl border border-cyan-300/40 bg-cyan-400/10 px-5 py-2.5 text-sm font-bold text-cyan-100 transition hover:bg-cyan-400/20"
                  >
                    Edit survey
                  </Link>
                ) : null}
                {isDraftRound ? (
                  <button
                    type="button"
                    onClick={() => void launchRound()}
                    disabled={isWorking || !selectedId}
                    className="rounded-xl bg-gradient-to-r from-emerald-300 to-cyan-400 px-5 py-2.5 text-sm font-black text-slate-950 shadow-lg transition hover:scale-[1.02] disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {isWorking ? "Launching…" : "Launch"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void closeRound()}
                    disabled={isWorking || !selectedId || isClosedRound}
                    className="rounded-xl border border-white/15 px-5 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-white/10 disabled:opacity-40"
                  >
                    Close round
                  </button>
                )}
                <button
                  onClick={downloadPdf}
                  disabled={!selectedId}
                  className="rounded-xl border border-violet-300/30 bg-violet-400/10 px-5 py-2.5 text-sm font-bold text-violet-100 transition hover:bg-violet-400/20 disabled:opacity-40"
                >
                  Download PDF
                </button>
              </div>
            </div>

            {error ? (
              <div className="mb-4 rounded-2xl border border-red-300/30 bg-red-500/15 px-5 py-4 text-red-100">
                {error}
              </div>
            ) : null}

            {selectedId && (roundResults || isResultsLoading) ? (
              <div className="flex min-h-0 w-full max-w-none flex-1 flex-col">
                <div className="mb-5 flex w-full shrink-0 gap-1 rounded-xl border border-white/10 bg-slate-900/80 p-1">
                  <button
                    type="button"
                    onClick={() => setResultsTab("overview")}
                    className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition ${
                      activeTab === "overview"
                        ? "bg-gradient-to-r from-cyan-400/30 to-blue-500/30 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Overview
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultsTab("individual")}
                    disabled={isResultsLoading || !roundResults}
                    className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                      activeTab === "individual"
                        ? "bg-gradient-to-r from-cyan-400/30 to-blue-500/30 text-white shadow"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    Individual responses
                  </button>
                </div>

                {roundResults ? (
                  <div className="grid w-full shrink-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <StatCard
                      label="Responses"
                      value={String(roundResults.totals.responseCount)}
                      sub={`${roundResults.totals.eligibleUserCount} eligible users`}
                    />
                    <StatCard
                      label="Response rate"
                      value={`${roundResults.totals.responseRate}%`}
                      sub={`${roundResults.completion.pendingUsers.length} not started · ${roundResults.completion.inProgressUsers.length} in progress`}
                    />
                    <StatCard
                      label="Round status"
                      value={roundResults.survey.status}
                      sub={`Version ${roundResults.survey.version}`}
                    />
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-8 text-center text-sm text-slate-400">
                    Loading results for round R{selectedRound?.version ?? "…"}…
                  </div>
                )}

                {activeTab === "overview" && roundResults ? (
                  <div className="mt-6 grid min-h-0 w-full flex-1 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,32%)] lg:items-stretch">
                    <section className="flex min-h-0 min-w-0 flex-col">
                      <DevSurveyQuestionOverview
                        questions={roundResults.questions}
                        resetKey={selectedId}
                      />
                    </section>

                    <aside className="flex min-h-0 min-w-0 flex-col">
                      <div className="flex h-full min-h-0 w-full flex-col rounded-3xl border border-white/10 bg-white/10 p-6 shadow-xl backdrop-blur lg:min-h-[20rem]">
                        <h2 className="text-xl font-black">Completion tracking</h2>
                        <p className="mt-1 text-xs text-slate-500">Click a name to view their answers</p>
                        <div className="mt-5 grid grid-cols-3 gap-3">
                          <div className="rounded-2xl bg-emerald-400/10 p-4">
                            <p className="text-3xl font-black text-emerald-200">{roundResults.completion.respondedUsers.length}</p>
                            <p className="text-sm text-slate-300">Responded</p>
                          </div>
                          <div className="rounded-2xl bg-sky-400/10 p-4">
                            <p className="text-3xl font-black text-sky-200">{roundResults.completion.inProgressUsers.length}</p>
                            <p className="text-sm text-slate-300">In progress</p>
                          </div>
                          <div className="rounded-2xl bg-amber-400/10 p-4">
                            <p className="text-3xl font-black text-amber-200">{roundResults.completion.pendingUsers.length}</p>
                            <p className="text-sm text-slate-300">Not started</p>
                          </div>
                        </div>
                        <div className="mt-5 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 lg:max-h-none">
                          {roundResults.completion.respondedUsers.length > 0 ? (
                            <>
                              <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-200">Responded</p>
                              {roundResults.completion.respondedUsers.map((user) => (
                                <CompletionUserRow
                                  key={user.id}
                                  name={user.name || user.email}
                                  email={user.email}
                                  onClick={() => openIndividualForUser(user.id)}
                                />
                              ))}
                            </>
                          ) : null}
                          {roundResults.completion.inProgressUsers.length > 0 ? (
                            <>
                              <p className="pt-2 text-xs font-bold uppercase tracking-[0.2em] text-sky-200">Drafts</p>
                              {roundResults.completion.inProgressUsers.map((user) => (
                                <CompletionUserRow
                                  key={user.id}
                                  name={user.name || user.email}
                                  email={user.email}
                                  sub={
                                    user.updatedAt
                                      ? `Last saved ${new Date(user.updatedAt).toLocaleString()}`
                                      : null
                                  }
                                  onClick={() => openIndividualForUser(user.id)}
                                />
                              ))}
                            </>
                          ) : null}
                          {roundResults.completion.pendingUsers.length > 0 ? (
                            <>
                              <p className="pt-2 text-xs font-bold uppercase tracking-[0.2em] text-amber-200">Not started</p>
                              {roundResults.completion.pendingUsers.map((user) => (
                                <div
                                  key={user.id}
                                  className="rounded-xl border border-white/10 bg-slate-950/30 px-3 py-2"
                                  title="No saved responses"
                                >
                                  <p className="text-sm font-semibold text-slate-400">{user.name || user.email}</p>
                                  <p className="text-xs text-slate-500">{user.email}</p>
                                </div>
                              ))}
                            </>
                          ) : null}
                        </div>
                      </div>
                    </aside>
                  </div>
                ) : activeTab === "individual" ? (
                  <div className="mt-6 flex min-h-0 w-full min-w-0 flex-1 flex-col space-y-6">
                    {selectedRound ? (
                      <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                        Round R{selectedRound.version} · {selectedRound.status}
                        {roundResults ? null : " · loading…"}
                      </p>
                    ) : null}
                    {roundResults ? (
                      <>
                        <DevSurveyPersonPicker
                          respondents={respondents}
                          selectedUserId={selectedUserId}
                          emptyMessage={`No one has saved a response for round R${roundResults.survey.version} yet.`}
                          onSelect={(userId) => {
                            if (!userId) {
                              setSelectedUserId(null);
                              const params = new URLSearchParams(searchParams?.toString() ?? "");
                              params.set("tab", "individual");
                              if (selectedId) params.set("round", selectedId);
                              params.delete("user");
                              router.replace(`/dev/survey?${params.toString()}`, { scroll: false });
                              return;
                            }
                            setSelectedUserId(userId);
                            const params = new URLSearchParams(searchParams?.toString() ?? "");
                            params.set("tab", "individual");
                            params.set("user", userId);
                            if (selectedId) params.set("round", selectedId);
                            router.replace(`/dev/survey?${params.toString()}`, { scroll: false });
                          }}
                        />
                        {selectedResponse ? (
                          <DevSurveyIndividualResponse
                            questions={roundResults.questions}
                            response={selectedResponse}
                          />
                        ) : (
                          <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-sm text-slate-400">
                            Search and select a person to view all of their answers for round R
                            {roundResults.survey.version}.
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/5 p-10 text-center text-sm text-slate-400">
                        Loading responses for this round…
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-3xl border border-white/10 bg-white/10 p-10 text-center text-slate-300">
                No survey round exists yet. Create a survey to start collecting feedback.
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function DevSurveyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">
          Loading survey dashboard...
        </div>
      }
    >
      <DevSurveyPageContent />
    </Suspense>
  );
}
