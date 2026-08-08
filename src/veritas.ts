type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type VeritasSnapshot = { activeRuns: readonly { id: string; status: string }[]; recentRuns: readonly { id: string; status: string }[] };

async function get(input: { endpoint: string; token: string; fetchImpl: FetchLike }, path: string): Promise<any> {
  const response = await input.fetchImpl(`${input.endpoint.replace(/\/$/, "")}${path}`, { headers: { authorization: `Bearer ${input.token}` } });
  if (!response.ok) throw new Error(`Veritas GET ${path} failed: ${response.status}`);
  return response.json();
}

function runs(value: unknown): { id: string; status: string }[] { return Array.isArray(value) ? value.map((run: any) => ({ id: String(run.id), status: String(run.status ?? "unknown") })) : []; }
export function normalizeVeritasSnapshot(value: any): VeritasSnapshot { return { activeRuns: runs(value?.activeRuns), recentRuns: runs(value?.runs) }; }
export function createVeritasClient(input: { endpoint: string; token: string; fetchImpl?: FetchLike }) {
  const transport = { ...input, fetchImpl: input.fetchImpl ?? fetch };
  return { async snapshot() { return normalizeVeritasSnapshot({ ...(await get(transport, "/api/cli/status")), ...(await get(transport, "/api/cli/runs?limit=20")) }); } };
}
export function normalizePollingSeconds(value: number | undefined): number { return Math.min(3600, Math.max(15, Math.floor(value ?? 60))); }
export function createPollingCoordinator<T>(input: { refresh: () => Promise<T>; intervalSeconds?: number; onError?: (error: unknown) => void }) { let cached: T | null = null; let timer: ReturnType<typeof setTimeout> | undefined; let active = false; const interval = normalizePollingSeconds(input.intervalSeconds) * 1000; const tick = async () => { if (!active) return; try { cached = await input.refresh(); } catch (error) { input.onError?.(error); } finally { if (active) timer = setTimeout(tick, interval); } }; return { get snapshot() { return cached; }, async refresh() { cached = await input.refresh(); return cached; }, start() { active = true; void tick(); }, stop() { active = false; if (timer) clearTimeout(timer); } }; }
