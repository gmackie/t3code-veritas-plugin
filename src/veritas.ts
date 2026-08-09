type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type VeritasRun = { id: string; status: string; targetType: string | null; stationName: string | null; evidenceCount: number };
export type VeritasSnapshot = { stationSummary: { online: number; total: number }; projects: readonly { id: string; name: string }[]; activeRuns: readonly VeritasRun[]; recentRuns: readonly VeritasRun[] };
export type CockpitViewModel = {
  navigation: readonly { id: string; title: string }[];
  overview: { activeRuns: number; recentFailures: number; stationsOnline: number; stationsTotal: number; evidenceFresh: number };
  targetTabs: readonly { id: "software" | "hardware"; title: string; runCount: number }[];
};
export type SurfaceCard =
  | { kind: "metric"; id: string; title: string; value: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }
  | { kind: "list"; id: string; title: string; items: readonly { id: string; title: string; detail?: string; status?: "neutral" | "positive" | "warning" | "negative" }[] };
export type SurfaceModel = { pluginId: string; navigationId: string; title: string; refreshedAt: string; cards: readonly SurfaceCard[] };
export type ReviewWorkflowModel = {
  readonly pluginId: string;
  readonly workflowId: string;
  readonly title: string;
  readonly currentStage: "inspect" | "context" | "propose" | "review" | "approve" | "execute" | "verify" | "respond";
  readonly refreshedAt: string;
  readonly steps: readonly { id: string; stage: ReviewWorkflowModel["currentStage"]; title: string; state: "pending" | "active" | "completed" | "blocked" | "failed"; detail?: string }[];
  readonly evidence?: readonly { id: string; title: string; kind: "check" | "artifact" | "diff" | "log" | "link"; status: "neutral" | "positive" | "warning" | "negative"; detail?: string }[];
  readonly actions?: readonly { id: string; title: string; tone?: "primary" | "secondary" | "destructive" }[];
};

export function buildReviewWorkflow(snapshot: VeritasSnapshot, state: { readonly approved?: boolean; readonly executionRequested?: boolean } = {}): ReviewWorkflowModel {
  const failures = snapshot.recentRuns.filter((run) => ["failed", "error", "inconclusive"].includes(run.status)).length;
  const hasEvidence = snapshot.recentRuns.some((run) => run.evidenceCount > 0);
  const checksHealthy = failures === 0 && snapshot.stationSummary.online === snapshot.stationSummary.total;
  const steps = [
    { id: "inspect", stage: "inspect" as const, title: "Inspect verification state", state: "completed" as const },
    { id: "context", stage: "context" as const, title: "Collect run and station context", state: "completed" as const, detail: `${snapshot.activeRuns.length} active runs · ${snapshot.recentRuns.length} recent runs` },
    { id: "propose", stage: "propose" as const, title: "Propose verification response", state: "completed" as const },
    { id: "review", stage: "review" as const, title: "Review evidence and failures", state: state.approved ? "completed" as const : "active" as const },
    { id: "approve", stage: "approve" as const, title: "Approve verification run", state: state.approved ? "completed" as const : "pending" as const },
    { id: "execute", stage: "execute" as const, title: "Execute verification run", state: state.executionRequested ? "completed" as const : state.approved ? "active" as const : "pending" as const },
    { id: "verify", stage: "verify" as const, title: "Verify returned evidence", state: state.executionRequested ? "active" as const : state.approved ? "pending" as const : checksHealthy ? "completed" as const : "active" as const, detail: `${failures} failing runs · ${snapshot.stationSummary.online}/${snapshot.stationSummary.total} stations online` },
    { id: "respond", stage: "respond" as const, title: "Prepare verification response", state: "pending" as const },
  ];
  return {
    pluginId: "com.t3code.veritas",
    workflowId: "veritas.evidence-review",
    title: "Evidence review",
    currentStage: state.executionRequested ? "verify" : state.approved ? "execute" : failures > 0 || !checksHealthy ? "review" : "approve",
    refreshedAt: new Date().toISOString(),
    steps,
    evidence: [{ id: "verification-health", title: "Verification health", kind: "check", status: checksHealthy && hasEvidence ? "positive" : failures > 0 ? "negative" : "warning", detail: `${snapshot.recentRuns.length} recent runs with ${snapshot.recentRuns.reduce((total, run) => total + run.evidenceCount, 0)} evidence records` }],
    actions: state.executionRequested ? [] : state.approved ? [{ id: "execute", title: "Execute verification run", tone: "primary" }] : [{ id: "approve", title: "Approve verification run", tone: "primary" }],
  };
}

async function get(input: { endpoint: string; token: string; fetchImpl: FetchLike }, path: string): Promise<any> {
  const response = await input.fetchImpl(`${input.endpoint.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${input.token}` } });
  if (!response.ok) throw new Error(`Veritas GET ${path} failed: ${response.status}`);
  return response.json();
}

function runs(value: unknown): VeritasRun[] { return Array.isArray(value) ? value.map((run: any) => ({ id: String(run.id), status: run.status === "pass" ? "passed" : String(run.status ?? "unknown"), targetType: typeof run.targetType === "string" ? run.targetType : null, stationName: typeof run.stationName === "string" ? run.stationName : null, evidenceCount: Array.isArray(run.evidence) ? run.evidence.length : 0 })) : []; }
export function normalizeVeritasSnapshot(value: any): VeritasSnapshot { return { stationSummary: { online: Number(value?.stations?.online ?? 0), total: Number(value?.stations?.total ?? 0) }, projects: Array.isArray(value?.projects) ? value.projects.map((project: any) => ({ id: String(project.id), name: String(project.name ?? project.id) })) : [], activeRuns: runs(value?.activeRuns), recentRuns: runs(value?.runs) }; }
export function buildCockpitViewModel(snapshot: VeritasSnapshot): CockpitViewModel {
  const allRuns = [...snapshot.activeRuns, ...snapshot.recentRuns];
  const softwareRuns = allRuns.filter((run) => run.targetType !== "hardware-rig" && run.targetType !== "fabrication-fixture").length;
  const hardwareRuns = allRuns.length - softwareRuns;
  return {
    navigation: ["Overview", "Runs", "Suites", "Targets", "Evidence", "Failures", "Provenance"].map((title) => ({ id: title.toLowerCase(), title })),
    overview: {
      activeRuns: snapshot.activeRuns.length,
      recentFailures: snapshot.recentRuns.filter((run) => ["failed", "error", "inconclusive"].includes(run.status)).length,
      stationsOnline: snapshot.stationSummary.online,
      stationsTotal: snapshot.stationSummary.total,
      evidenceFresh: snapshot.recentRuns.reduce((total, run) => total + run.evidenceCount, 0),
    },
    targetTabs: [
      { id: "software", title: "Software", runCount: softwareRuns },
      { id: "hardware", title: "Hardware", runCount: hardwareRuns },
    ],
  };
}
export function buildSurfaceModel(snapshot: VeritasSnapshot, navigationId = "veritas.overview"): SurfaceModel {
  const view = buildCockpitViewModel(snapshot);
  return {
    pluginId: "com.t3code.veritas",
    navigationId,
    title: "Verification cockpit",
    refreshedAt: new Date().toISOString(),
    cards: [
      { kind: "metric", id: "active-runs", title: "Active runs", value: `${view.overview.activeRuns}`, status: view.overview.activeRuns === 0 ? "positive" : "warning" },
      { kind: "metric", id: "stations", title: "Stations online", value: `${view.overview.stationsOnline}/${view.overview.stationsTotal}`, status: view.overview.stationsOnline === view.overview.stationsTotal ? "positive" : "warning" },
      { kind: "metric", id: "evidence", title: "Recent evidence", value: `${view.overview.evidenceFresh}` },
      { kind: "list", id: "runs", title: "Recent verification runs", items: [...snapshot.activeRuns, ...snapshot.recentRuns].slice(0, 10).map((run) => ({ id: run.id, title: run.id, detail: [run.status, run.targetType ?? "target unknown", run.stationName ?? "station unknown"].join(" · "), status: ["failed", "error", "inconclusive"].includes(run.status) ? "negative" as const : run.status === "passed" ? "positive" as const : "warning" as const })) },
    ],
  };
}
export function createVeritasClient(input: { endpoint: string; token: string; fetchImpl?: FetchLike }) {
  const transport = { ...input, fetchImpl: input.fetchImpl ?? fetch };
  return {
    async snapshot() { return normalizeVeritasSnapshot({ ...(await get(transport, "/api/cli/status")), ...(await get(transport, "/api/cli/runs?limit=20")) }); },
    async startRun(runInput: { projectId?: string; targetType?: string }) {
      const response = await transport.fetchImpl(`${transport.endpoint.replace(/\/$/u, "")}/api/cli/runs`, { method: "POST", headers: { authorization: `Bearer ${transport.token}`, "content-type": "application/json" }, body: JSON.stringify(runInput) });
      if (!response.ok) throw new Error(`Veritas POST /api/cli/runs failed: ${response.status}`);
      return response.json() as Promise<{ runId?: string }>;
    },
  };
}
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
