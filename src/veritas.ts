// Veritas domain module: the CLI API client (/api/cli/*, Bearer `vrt_` token)
// plus pure normalizers and view models shared by the MCP tools and views.
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type VeritasRun = {
  id: string;
  status: string;
  targetType: string | null;
  stationName: string | null;
  suiteId?: string;
  suiteName?: string;
  stationId?: string;
  deviceId?: string;
  deviceSerial?: string;
  triggeredBy?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt?: string;
};
export type VeritasSnapshot = { stationSummary: { online: number; total: number }; projects: readonly { id: string; name: string }[]; activeRuns: readonly VeritasRun[]; recentRuns: readonly VeritasRun[] };
export type VeritasFamily = { id: string; name: string; slug?: string; activeFirmwareVersion?: string; health?: string };
export type VeritasSuite = { id: string; name: string; description?: string; model?: string; totalRuns: number; lastRunAt?: string };
export type CockpitViewModel = {
  navigation: readonly { id: string; title: string }[];
  overview: { activeRuns: number; recentFailures: number; stationsOnline: number; stationsTotal: number };
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

export const FAILING_STATUSES: readonly string[] = ["failed", "error", "inconclusive"];
export const isFailing = (run: Pick<VeritasRun, "status">) => FAILING_STATUSES.includes(run.status);

export function buildReviewWorkflow(snapshot: VeritasSnapshot, state: { readonly approved?: boolean; readonly executionRequested?: boolean } = {}): ReviewWorkflowModel {
  const failures = snapshot.recentRuns.filter(isFailing).length;
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
    evidence: [{ id: "verification-health", title: "Verification health", kind: "check", status: checksHealthy ? "positive" : failures > 0 ? "negative" : "warning", detail: `${failures} failing of ${snapshot.recentRuns.length} recent runs · evidence records unavailable (no Veritas CLI route yet)` }],
    actions: state.executionRequested ? [] : state.approved ? [{ id: "execute", title: "Execute verification run", tone: "primary" }] : [{ id: "approve", title: "Approve verification run", tone: "primary" }],
  };
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
const opt = <K extends string>(key: K, value: unknown): Partial<Record<K, string>> => {
  const found = text(value);
  return found ? ({ [key]: found } as Record<K, string>) : {};
};
// The CLI API reports run status as passed/failed/running/pending and result
// status as pass/fail; normalize both to the run vocabulary.
const runStatus = (value: unknown) => (value === "pass" ? "passed" : value === "fail" ? "failed" : String(value ?? "unknown"));

function runs(value: unknown): VeritasRun[] {
  return Array.isArray(value)
    ? value.map((run: any) => ({
        id: String(run.id),
        status: runStatus(run.status),
        targetType: typeof run.targetType === "string" ? run.targetType : null,
        stationName: typeof run.stationName === "string" ? run.stationName : null,
        ...opt("suiteId", run.testSuiteId),
        ...opt("suiteName", run.suiteName),
        ...opt("stationId", run.stationId ?? run.testStationId),
        ...opt("deviceId", run.deviceId),
        ...opt("deviceSerial", run.deviceSerial),
        ...opt("triggeredBy", run.triggeredBy),
        ...opt("startedAt", run.startedAt),
        ...opt("completedAt", run.completedAt),
        ...opt("createdAt", run.createdAt),
      }))
    : [];
}
export function normalizeVeritasSnapshot(value: any): VeritasSnapshot { return { stationSummary: { online: Number(value?.stations?.online ?? 0), total: Number(value?.stations?.total ?? 0) }, projects: Array.isArray(value?.projects) ? value.projects.map((project: any) => ({ id: String(project.id), name: String(project.name ?? project.id) })) : [], activeRuns: runs(value?.activeRuns), recentRuns: runs(value?.runs) }; }

export function normalizeFamilies(value: unknown): VeritasFamily[] {
  return Array.isArray(value)
    ? value.map((family: any) => ({
        id: String(family.id),
        name: String(family.name ?? family.id),
        ...opt("slug", family.slug),
        ...opt("activeFirmwareVersion", family.activeFirmwareVersion),
        ...opt("health", family.healthStatus ?? family.healthSummary?.status),
      }))
    : [];
}

export function normalizeSuites(value: unknown): VeritasSuite[] {
  return Array.isArray(value)
    ? value.map((suite: any) => ({
        id: String(suite.id),
        name: String(suite.name ?? suite.id),
        ...opt("description", suite.description),
        ...opt("model", suite.model),
        totalRuns: Number(suite.totalRuns ?? 0),
        ...opt("lastRunAt", suite.lastRunAt),
      }))
    : [];
}

export function buildCockpitViewModel(snapshot: VeritasSnapshot): CockpitViewModel {
  const allRuns = [...snapshot.activeRuns, ...snapshot.recentRuns];
  const softwareRuns = allRuns.filter((run) => run.targetType !== "hardware-rig" && run.targetType !== "fabrication-fixture").length;
  const hardwareRuns = allRuns.length - softwareRuns;
  return {
    navigation: ["Overview", "Runs", "Suites", "Targets", "Evidence", "Failures", "Provenance"].map((title) => ({ id: title.toLowerCase(), title })),
    overview: {
      activeRuns: snapshot.activeRuns.length,
      recentFailures: snapshot.recentRuns.filter(isFailing).length,
      stationsOnline: snapshot.stationSummary.online,
      stationsTotal: snapshot.stationSummary.total,
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
      { kind: "list", id: "runs", title: "Recent verification runs", items: [...snapshot.activeRuns, ...snapshot.recentRuns].slice(0, 10).map((run) => ({ id: run.id, title: run.suiteName ?? run.id, detail: [run.status, run.targetType ?? "target unknown", run.stationName ?? "station unknown"].join(" · "), status: isFailing(run) ? "negative" as const : run.status === "passed" ? "positive" as const : "warning" as const })) },
    ],
  };
}

export class VeritasApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "VeritasApiError";
  }
}

export const REQUEST_TIMEOUT_MS = 15_000;

export type RunFilter = { suiteId?: string; status?: string; limit?: number };
export type StartRunInput = { suiteId: string; stationId: string; deviceId: string };

export function createVeritasClient(input: { endpoint: string; token: string; fetchImpl?: FetchLike; timeoutMs?: number }) {
  const doFetch: FetchLike = input.fetchImpl ?? ((url, init) => fetch(url, init));
  const base = input.endpoint.replace(/\/+$/u, "");
  const timeoutMs = input.timeoutMs ?? REQUEST_TIMEOUT_MS;

  // Error messages reach agents and views: never include the endpoint URL,
  // and keep 5xx bodies (which may carry stack traces) out entirely.
  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", authorization: `Bearer ${input.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new VeritasApiError(504, `Veritas did not respond within ${Math.max(1, Math.ceil(timeoutMs / 1000))}s`);
      throw new VeritasApiError(0, "Could not reach Veritas. Check VERITAS_URL and the network.");
    }
    const raw = await response.text();
    let json: unknown = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    if (!response.ok) {
      if (response.status >= 500) throw new VeritasApiError(response.status, `Veritas is temporarily unavailable (${response.status})`);
      if (response.status === 401) throw new VeritasApiError(401, "Veritas rejected the token (401). Check VERITAS_TOKEN.");
      const detail = json && typeof json === "object" && "error" in json ? String((json as { error: unknown }).error).slice(0, 200) : response.statusText;
      throw new VeritasApiError(response.status, `Veritas ${method} ${path.split("?")[0]} failed (${response.status}): ${detail}`);
    }
    if (json === null) throw new VeritasApiError(502, "Veritas returned an unreadable response");
    return json as T;
  }

  const runsQuery = (filter: RunFilter = {}) => {
    const params = new URLSearchParams();
    if (filter.suiteId) params.set("suiteId", filter.suiteId);
    if (filter.status) params.set("status", filter.status);
    params.set("limit", String(Math.min(200, Math.max(1, Math.floor(filter.limit ?? 20)))));
    return `/api/cli/runs?${params}`;
  };

  return {
    async snapshot(filter: RunFilter = {}) {
      const [status, recent] = await Promise.all([call<Record<string, unknown>>("GET", "/api/cli/status"), call<Record<string, unknown>>("GET", runsQuery(filter))]);
      return { snapshot: normalizeVeritasSnapshot({ ...status, ...recent }), families: normalizeFamilies(status.families) };
    },
    async runs(filter: RunFilter = {}) {
      return normalizeVeritasSnapshot(await call<Record<string, unknown>>("GET", runsQuery(filter))).recentRuns;
    },
    async suites() {
      return normalizeSuites((await call<{ suites?: unknown }>("GET", "/api/cli/suites")).suites);
    },
    // Queues a pending run of a suite on a station and device (scope runs:trigger).
    async startRun(run: StartRunInput) {
      const result = await call<{ runId?: unknown; status?: unknown }>("POST", `/api/cli/suites/${encodeURIComponent(run.suiteId)}/run`, { stationId: run.stationId, deviceId: run.deviceId });
      if (typeof result.runId !== "string") throw new VeritasApiError(502, "Veritas did not return a run id");
      return { runId: result.runId, status: typeof result.status === "string" ? result.status : "pending" };
    },
  };
}
export type VeritasClient = ReturnType<typeof createVeritasClient>;

export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(Number.isFinite(value) ? value! : 60))); }
