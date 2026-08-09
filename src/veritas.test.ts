import { describe, expect, test } from "bun:test";
import { buildCockpitViewModel, createPollingCoordinator, createVeritasClient, normalizeVeritasSnapshot } from "./veritas.ts";

describe("Veritas adapter", () => {
  test("normalizes CLI status and runs", () => {
    expect(normalizeVeritasSnapshot({ activeRuns: [{ id: "r1", status: "running" }], runs: [{ id: "r0", status: "passed" }] })).toEqual({
      stationSummary: { online: 0, total: 0 },
      projects: [],
      activeRuns: [{ id: "r1", status: "running", targetType: null, stationName: null, evidenceCount: 0 }],
      recentRuns: [{ id: "r0", status: "passed", targetType: null, stationName: null, evidenceCount: 0 }],
    });
  });

  test("reads status and recent runs from the Veritas CLI API", async () => {
    const paths: string[] = [];
    const client = createVeritasClient({ endpoint: "https://veritas.example", token: "secret", fetchImpl: async (input) => {
      paths.push(new URL(String(input)).pathname);
      return new Response(JSON.stringify(paths.at(-1) === "/api/cli/status" ? { activeRuns: [] } : { runs: [] }), { status: 200 });
    } });
    await client.snapshot();
    expect(paths).toEqual(["/api/cli/status", "/api/cli/runs"]);
  });

  test("caches the latest verification refresh", async () => {
    const coordinator = createPollingCoordinator({ refresh: async () => ({ activeRuns: [], recentRuns: [] }) });
    await coordinator.refresh();
    expect(coordinator.snapshot).toEqual({ activeRuns: [], recentRuns: [] });
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
      activeRuns: [{ id: "r1", status: "running", targetType: "hardware-rig", stationName: "Bench A", evidenceCount: 0 }],
      recentRuns: [{ id: "r0", status: "passed", targetType: "simulator", stationName: null, evidenceCount: 1 }],
    });
  });

  test("builds owned cockpit navigation and software/hardware tabs", () => {
    const view = buildCockpitViewModel({
      stationSummary: { online: 2, total: 3 },
      projects: [{ id: "p1", name: "Firmware" }],
      activeRuns: [{ id: "r1", status: "running", targetType: "hardware-rig", stationName: "Bench A", evidenceCount: 0 }],
      recentRuns: [{ id: "r0", status: "passed", targetType: "simulator", stationName: null, evidenceCount: 2 }],
    });
    expect(view.navigation.map((item) => item.id)).toEqual(["overview", "runs", "suites", "targets", "evidence", "failures", "provenance"]);
    expect(view.overview).toEqual({ activeRuns: 1, recentFailures: 0, stationsOnline: 2, stationsTotal: 3, evidenceFresh: 2 });
    expect(view.targetTabs).toEqual([{ id: "software", title: "Software", runCount: 1 }, { id: "hardware", title: "Hardware", runCount: 1 }]);
  });
});
