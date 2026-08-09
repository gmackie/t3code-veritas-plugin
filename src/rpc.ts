import { buildReviewWorkflow, buildSurfaceModel, type VeritasSnapshot } from "./veritas.ts";

export function createRpcHandler<T extends { activeRuns?: unknown; recentRuns?: unknown; stationSummary?: unknown }>(coordinator: { snapshot: T | null; refresh(): Promise<T>; workflowState?: { approved: boolean }; saveWorkflowState?: () => Promise<void> }) {
  const workflowState = coordinator.workflowState ?? { approved: false };
  return async (method: string, payload?: { navigationId?: string; panelId?: string; actionId?: string; workflowId?: string; input?: unknown }) => {
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
      case "surface.get": {
        const value = (await snapshot()) as unknown as VeritasSnapshot;
        return { ok: true as const, result: buildSurfaceModel(value, "veritas.overview") };
      }
      case "workflow.get": {
        const value = (await snapshot()) as unknown as VeritasSnapshot;
        return { ok: true as const, result: buildReviewWorkflow(value, workflowState) };
      }
      case "action.execute":
        if (payload?.actionId === "approve") {
          workflowState.approved = true;
          await coordinator.saveWorkflowState?.();
          return { ok: true as const, result: { status: "accepted" as const, message: "Verification run approved." } };
        }
        return payload?.actionId === "veritas.trigger-run"
          ? { ok: true as const, result: { status: "accepted" as const, message: "Verification run queued by Veritas." } }
          : { ok: false as const, error: `unsupported Veritas action: ${String(payload?.actionId)}` };
      case "panel.get": {
        const value = (await snapshot()) as unknown as VeritasSnapshot;
        if (payload?.panelId !== "veritas.thread-run") return { ok: false as const, error: `unsupported Veritas panel: ${String(payload?.panelId)}` };
        return {
          ok: true as const,
          result: {
            pluginId: "com.t3code.veritas",
            panelId: "veritas.thread-run",
            title: "Thread verification",
            kind: "verification" as const,
            refreshedAt: new Date().toISOString(),
            content: {
              kind: "verification" as const,
              status: value.activeRuns.length > 0 ? "running" as const : value.recentRuns.some((run) => ["failed", "error", "inconclusive"].includes(run.status)) ? "failed" as const : "passed" as const,
              summary: `${value.recentRuns.length} recent runs · ${value.activeRuns.length} active`,
              runs: [...value.activeRuns, ...value.recentRuns].slice(0, 8).map((run) => ({ id: run.id, title: run.id, status: run.status, ...(run.stationName ? { detail: run.stationName } : {}) })),
              actions: [{ id: "veritas.trigger-run", title: "Start verification", tone: "primary" as const }],
            },
          },
        };
      }
      default:
        return { ok: false as const, error: `unsupported Veritas RPC method: ${method}` };
    }
  };
}
