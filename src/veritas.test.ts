import { describe, expect, test } from "bun:test";
import { buildCockpitViewModel, buildReviewWorkflow, buildSurfaceModel, createVeritasClient, normalizeFamilies, normalizePollingSeconds, normalizeVeritasSnapshot } from "./veritas.ts";

describe("Veritas adapter", () => {
  test("normalizes CLI status and runs", () => {
    expect(normalizeVeritasSnapshot({ activeRuns: [{ id: "r1", status: "running" }], runs: [{ id: "r0", status: "passed" }] })).toEqual({
      stationSummary: { online: 0, total: 0 },
      projects: [],
      activeRuns: [{ id: "r1", status: "running", targetType: null, stationName: null }],
      recentRuns: [{ id: "r0", status: "passed", targetType: null, stationName: null }],
    });
  });

  test("reads status and recent runs from the Veritas CLI API", async () => {
    const seen: { path: string; auth: string | null }[] = [];
    const client = createVeritasClient({ endpoint: "https://veritas.example/", token: "secret", fetchImpl: async (input, init) => {
      const url = new URL(input);
      seen.push({ path: `${url.pathname}${url.search}`, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify(url.pathname === "/api/cli/status" ? { activeRuns: [], families: [{ id: "f1", name: "Sensor", healthStatus: "healthy" }] } : { runs: [] }), { status: 200 });
    } });
    const { families } = await client.snapshot({ suiteId: "s1", limit: 5 });
    expect(seen.map((entry) => entry.path).sort()).toEqual(["/api/cli/runs?suiteId=s1&limit=5", "/api/cli/status"]);
    expect(seen.every((entry) => entry.auth === "Bearer secret")).toBe(true);
    expect(families).toEqual([{ id: "f1", name: "Sensor", health: "healthy" }]);
  });

  test("clamps the refresh interval like the v1 setting", () => {
    expect(normalizePollingSeconds(undefined)).toBe(60);
    expect(normalizePollingSeconds(1)).toBe(15);
    expect(normalizePollingSeconds(99999)).toBe(3600);
    expect(normalizeFamilies(null)).toEqual([]);
  });

  test("normalizes the full cockpit summary across software and physical targets", () => {
    expect(normalizeVeritasSnapshot({
      stations: { online: 2, total: 3 },
      projects: [{ id: "p1", name: "Firmware" }],
      activeRuns: [{ id: "r1", status: "running", targetType: "hardware-rig", stationName: "Bench A" }],
      runs: [{ id: "r0", status: "pass", targetType: "simulator", suiteName: "Smoke", evidence: [{ id: "e1" }] }],
    })).toEqual({
      stationSummary: { online: 2, total: 3 },
      projects: [{ id: "p1", name: "Firmware" }],
      activeRuns: [{ id: "r1", status: "running", targetType: "hardware-rig", stationName: "Bench A" }],
      recentRuns: [{ id: "r0", status: "passed", targetType: "simulator", stationName: null, suiteName: "Smoke" }],
    });
  });

  test("builds owned cockpit navigation and software/hardware tabs", () => {
    const view = buildCockpitViewModel({
      stationSummary: { online: 2, total: 3 },
      projects: [{ id: "p1", name: "Firmware" }],
      activeRuns: [{ id: "r1", status: "running", targetType: "hardware-rig", stationName: "Bench A" }],
      recentRuns: [{ id: "r0", status: "passed", targetType: "simulator", stationName: null }],
    });
    expect(view.navigation.map((item) => item.id)).toEqual(["overview", "runs", "suites", "targets", "evidence", "failures", "provenance"]);
    expect(view.overview).toEqual({ activeRuns: 1, recentFailures: 0, stationsOnline: 2, stationsTotal: 3 });
    expect(view.targetTabs).toEqual([{ id: "software", title: "Software", runCount: 1 }, { id: "hardware", title: "Hardware", runCount: 1 }]);
  });

  test("builds native T3 verification cards across software and hardware runs", () => {
    const surface = buildSurfaceModel({
      stationSummary: { online: 2, total: 3 },
      projects: [],
      activeRuns: [{ id: "r1", status: "running", targetType: "hardware-rig", stationName: "Bench A" }],
      recentRuns: [{ id: "r0", status: "passed", targetType: "simulator", stationName: null }],
    });
    expect(surface.pluginId).toBe("com.t3code.veritas");
    expect(surface.cards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "stations", value: "2/3" }),
      expect.objectContaining({ id: "runs" }),
    ]));
  });

  test("builds the canonical evidence review workflow", () => {
    const workflow = buildReviewWorkflow({
      stationSummary: { online: 1, total: 2 },
      projects: [],
      activeRuns: [],
      recentRuns: [{ id: "r1", status: "failed", targetType: "simulator", stationName: null }],
    });
    expect(workflow.currentStage).toBe("review");
    expect(workflow.steps.find((step) => step.stage === "review")?.state).toBe("active");
    expect(workflow.evidence?.[0]?.status).toBe("negative");
  });

  test("reports verification health without inventing evidence counts", () => {
    const workflow = buildReviewWorkflow({ stationSummary: { online: 2, total: 2 }, projects: [], activeRuns: [], recentRuns: [{ id: "r0", status: "passed", targetType: null, stationName: null }] });
    expect(workflow.evidence?.[0]).toMatchObject({ status: "positive", detail: "0 failing of 1 recent runs · evidence records unavailable (no Veritas CLI route yet)" });
  });

  test("moves the evidence workflow to execution after approval", () => {
    const workflow = buildReviewWorkflow({ stationSummary: { online: 2, total: 2 }, projects: [], activeRuns: [], recentRuns: [] }, { approved: true });
    expect(workflow.currentStage).toBe("execute");
    expect(workflow.steps.find((step) => step.stage === "approve")?.state).toBe("completed");
    expect(workflow.actions?.[0]?.id).toBe("execute");
  });

  test("moves the evidence workflow to verification after execution is requested", () => {
    const workflow = buildReviewWorkflow({ stationSummary: { online: 2, total: 2 }, projects: [], activeRuns: [], recentRuns: [] }, { approved: true, executionRequested: true });
    expect(workflow.currentStage).toBe("verify");
    expect(workflow.steps.find((step) => step.stage === "execute")?.state).toBe("completed");
  });
});
