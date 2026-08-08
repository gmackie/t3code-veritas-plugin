import { describe, expect, test } from "bun:test";
import { createPollingCoordinator, createVeritasClient, normalizeVeritasSnapshot } from "./veritas.ts";

describe("Veritas adapter", () => {
  test("normalizes CLI status and runs", () => {
    expect(normalizeVeritasSnapshot({ activeRuns: [{ id: "r1", status: "running" }], runs: [{ id: "r0", status: "passed" }] })).toEqual({
      activeRuns: [{ id: "r1", status: "running" }],
      recentRuns: [{ id: "r0", status: "passed" }],
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
});
