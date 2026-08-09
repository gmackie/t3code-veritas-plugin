type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type VeritasRun = { id: string; status: string; targetType: string | null; stationName: string | null; evidenceCount: number };
export type VeritasSnapshot = { stationSummary: { online: number; total: number }; projects: readonly { id: string; name: string }[]; activeRuns: readonly VeritasRun[]; recentRuns: readonly VeritasRun[] };

async function get(input: { endpoint: string; token: string; fetchImpl: FetchLike }, path: string): Promise<any> {
  const response = await input.fetchImpl(`${input.endpoint.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${input.token}` } });
  if (!response.ok) throw new Error(`Veritas GET ${path} failed: ${response.status}`);
  return response.json();
}

function runs(value: unknown): VeritasRun[] { return Array.isArray(value) ? value.map((run: any) => ({ id: String(run.id), status: run.status === "pass" ? "passed" : String(run.status ?? "unknown"), targetType: typeof run.targetType === "string" ? run.targetType : null, stationName: typeof run.stationName === "string" ? run.stationName : null, evidenceCount: Array.isArray(run.evidence) ? run.evidence.length : 0 })) : []; }
export function normalizeVeritasSnapshot(value: any): VeritasSnapshot { return { stationSummary: { online: Number(value?.stations?.online ?? 0), total: Number(value?.stations?.total ?? 0) }, projects: Array.isArray(value?.projects) ? value.projects.map((project: any) => ({ id: String(project.id), name: String(project.name ?? project.id) })) : [], activeRuns: runs(value?.activeRuns), recentRuns: runs(value?.runs) }; }
export function createVeritasClient(input: { endpoint: string; token: string; fetchImpl?: FetchLike }) {
  const transport = { ...input, fetchImpl: input.fetchImpl ?? fetch };
  return { async snapshot() { return normalizeVeritasSnapshot({ ...(await get(transport, "/api/cli/status")), ...(await get(transport, "/api/cli/runs?limit=20")) }); } };
}
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
