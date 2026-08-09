export function createRpcHandler<T extends { activeRuns?: unknown; recentRuns?: unknown; stationSummary?: unknown }>(coordinator: { snapshot: T | null; refresh(): Promise<T> }) {
  return async (method: string) => {
    const snapshot = () => coordinator.snapshot ?? coordinator.refresh();
    switch (method) {
      case "verification.status":
      case "cockpit.status":
        return { ok: true as const, result: await snapshot() };
      case "verification.refresh":
      case "cockpit.refresh":
        return { ok: true as const, result: await coordinator.refresh() };
      case "runs.active":
        return { ok: true as const, result: (await snapshot()).activeRuns ?? [] };
      case "runs.recent":
        return { ok: true as const, result: (await snapshot()).recentRuns ?? [] };
      case "targets.summary":
        return { ok: true as const, result: (await snapshot()).stationSummary ?? { online: 0, total: 0 } };
      default:
        return { ok: false as const, error: `unsupported Veritas RPC method: ${method}` };
    }
  };
}
