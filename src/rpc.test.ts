import { describe, expect, test } from "bun:test";
import { createRpcHandler } from "./rpc.ts";

describe("Veritas cockpit RPC", () => {
  test("serves cockpit status and scoped collections from the cached snapshot", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [{ id: "p1" }], activeRuns: [{ id: "r1" }], recentRuns: [], stationSummary: { online: 1, total: 1 } }, refresh: async () => ({}) });
    expect(await handler("cockpit.status")).toEqual({ ok: true, result: { projects: [{ id: "p1" }], activeRuns: [{ id: "r1" }], recentRuns: [], stationSummary: { online: 1, total: 1 } } });
    expect(await handler("runs.active")).toEqual({ ok: true, result: [{ id: "r1" }] });
    expect(await handler("targets.summary")).toEqual({ ok: true, result: { online: 1, total: 1 } });
  });

  test("serves the native verification surface", async () => {
    const handler = createRpcHandler({ snapshot: { projects: [], activeRuns: [], recentRuns: [], stationSummary: { online: 1, total: 1 } }, refresh: async () => ({}) });
    await expect(handler("surface.get")).resolves.toMatchObject({ ok: true, result: { pluginId: "com.t3code.veritas" } });
  });
});
