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
  return { async snapshot() { return normalizeVeritasSnapshot({ ...(await get(transport, "/api/cli/status")), ...(await get(transport, "/api/cli/runs?limit=20")) }); } };
}
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
