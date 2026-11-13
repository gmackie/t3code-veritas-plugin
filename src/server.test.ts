import { afterEach, describe, expect, it } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import { call, connectedClient, fakeVeritas } from "./testing.ts";
import type { CockpitData, ReviewData } from "./views/render.ts";

const cleanups: (() => unknown)[] = [];
const connect = async (options: Parameters<typeof connectedClient>[0] = {}) => {
  const connection = await connectedClient(options);
  cleanups.push(() => connection.close());
  return connection;
};
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("Veritas MCP server", () => {
  it("links UI tools to ui:// views and keeps starting runs away from the model", async () => {
    const { client } = await connect();
    const byName = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool]));
    expect([...byName.keys()].sort()).toEqual(["veritas_cockpit", "veritas_evidence_review", "veritas_run_get", "veritas_run_start", "veritas_suites_list"]);
    expect(byName.get("veritas_cockpit")?._meta).toMatchObject({ ui: { resourceUri: "ui://veritas/cockpit.html", visibility: ["model", "app"] } });
    expect(byName.get("veritas_evidence_review")?._meta).toMatchObject({ ui: { resourceUri: "ui://veritas/evidence-review.html", visibility: ["model", "app"] } });
    expect(byName.get("veritas_run_start")?._meta).toEqual({ ui: { visibility: ["app"] } });
    expect(byName.get("veritas_cockpit")?.annotations?.readOnlyHint).toBe(true);
    expect(byName.get("veritas_run_start")?.annotations?.readOnlyHint).toBeUndefined();
  });

  it("serves each view as a self-contained MCP App resource", async () => {
    const { client } = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([
      ["ui://veritas/cockpit.html", RESOURCE_MIME_TYPE],
      ["ui://veritas/evidence-review.html", RESOURCE_MIME_TYPE],
    ]);
    for (const resource of resources) {
      const html = ((await client.readResource({ uri: resource.uri })).contents[0] as { text: string }).text;
      expect(html).toStartWith("<!doctype html>");
      expect(html).toContain("ui/initialize");
      // T3's sandbox CSP is default-src 'none': nothing may load from outside.
      expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
      expect(html.length).toBeLessThan(100_000);
    }
  });

  it("reads the cockpit from the Veritas CLI API", async () => {
    const { client, fake } = await connect({ defaultSuiteId: "s1" });
    const result = await call<CockpitData>(client, "veritas_cockpit", { status: "failed" });
    expect(result.isError).toBeFalsy();
    expect(fake!.requests).toEqual(expect.arrayContaining(["GET /api/cli/status", "GET /api/cli/runs?suiteId=s1&status=failed&limit=20", "GET /api/cli/suites"]));
    const data = result.structuredContent!;
    expect(data.snapshot.stationSummary).toEqual({ online: 1, total: 2 });
    expect(data.snapshot.recentRuns.map((run) => run.id)).toEqual(["run-fail-1"]);
    expect(data.snapshot.recentRuns[0]).toMatchObject({ suiteId: "s1", stationId: "st1", deviceId: "d1", deviceSerial: "SN-1" });
    expect(data.families).toEqual([{ id: "f1", name: "Sensor board", slug: "sensor", activeFirmwareVersion: "1.4.2", health: "healthy" }]);
    expect(data.suites).toHaveLength(1);
    expect(data.view.overview.recentFailures).toBe(1);
    expect(data.pollSeconds).toBe(30);
    expect(result.content[0]?.text).toContain("1 failing");
    expect(result.content[0]?.text).toContain("run-fail-1 [failed] Smoke <fw> · Bench A · SN-1");
  });

  it("finds one run by id prefix and reports unknown runs", async () => {
    const { client } = await connect();
    const found = await call<{ run: { id: string } }>(client, "veritas_run_get", { runId: "run-pass" });
    expect(found.structuredContent?.run.id).toBe("run-pass-2");
    const ambiguous = await call(client, "veritas_run_get", { runId: "run-" });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.content[0]?.text).toContain("matches 2 runs");
    const missing = await call(client, "veritas_run_get", { runId: "nope" });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain("No Veritas run nope");
  });

  it("starts a run from the review and follows it to verification", async () => {
    const { client, fake } = await connect();
    const review = await call<ReviewData>(client, "veritas_evidence_review", { suiteId: "s1" });
    expect(review.structuredContent?.workflow.currentStage).toBe("review");
    expect(review.structuredContent?.workflow.actions?.[0]?.id).toBe("approve");
    expect(review.structuredContent?.targets).toEqual([
      { suiteId: "s1", stationId: "st1", deviceId: "d1", label: "Smoke <fw> · Bench A · SN-1" },
      { suiteId: "s1", stationId: "st1", deviceId: "d2", label: "Smoke <fw> · Bench A · SN-2" },
    ]);

    const started = await call<{ runId: string; status: string }>(client, "veritas_run_start", { suiteId: "s1", stationId: "st1", deviceId: "d1" });
    expect(started.structuredContent).toEqual({ runId: "run-new-1", status: "pending" });
    expect(fake!.started).toEqual([{ suiteId: "s1", stationId: "st1", deviceId: "d1" }]);

    const verify = await call<ReviewData>(client, "veritas_evidence_review", { suiteId: "s1", startedRunId: "run-new-1" });
    expect(verify.structuredContent).toMatchObject({ workflow: { currentStage: "verify", actions: [] }, startedRun: { id: "run-new-1", status: "running" }, settled: false });
    expect(verify.content[0]?.text).toContain("Started run run-new-1 is running.");
  });

  it("passes Veritas validation errors through without claiming success", async () => {
    const { client, fake } = await connect();
    const result = await call(client, "veritas_run_start", { suiteId: "s1", stationId: "st1", deviceId: " " });
    expect(result.isError).toBe(true);
    expect(fake!.started).toEqual([]);
  });

  it("explains a missing token on every tool", async () => {
    const { client } = await connect({ token: null });
    for (const [name, args] of [["veritas_cockpit", {}], ["veritas_suites_list", {}], ["veritas_run_get", { runId: "r" }], ["veritas_evidence_review", {}], ["veritas_run_start", { suiteId: "s", stationId: "st", deviceId: "d" }]] as const) {
      const result = await call(client, name, args);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("VERITAS_TOKEN");
    }
  });

  it("reports a rejected token", async () => {
    const { client } = await connect({ token: "vrt_wrong" });
    const result = await call(client, "veritas_suites_list");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Veritas rejected the token (401). Check VERITAS_TOKEN.");
  });

  it("keeps upstream failures short and free of URLs and bodies", async () => {
    const fake = fakeVeritas({ fail: 503 });
    cleanups.push(() => fake.stop());
    const { client } = await connect({ endpoint: fake.url });
    const result = await call(client, "veritas_cockpit");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Veritas is temporarily unavailable (503)");
    expect(JSON.stringify(result)).not.toContain(fake.url);
    expect(JSON.stringify(result)).not.toContain("stack trace");
  });

  it("times out slow upstream calls", async () => {
    const fake = fakeVeritas({ delayMs: 200 });
    cleanups.push(() => fake.stop());
    const { client } = await connect({ endpoint: fake.url, timeoutMs: 50 });
    const result = await call(client, "veritas_suites_list");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Veritas did not respond within 1s");
  });

  it("reports an unreachable endpoint without its URL", async () => {
    const { client } = await connect({ endpoint: "http://127.0.0.1:9" });
    const result = await call(client, "veritas_suites_list");
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Could not reach Veritas. Check VERITAS_URL and the network.");
  });

  it("keeps the cockpit available when suites need a scope the token lacks", async () => {
    const fake = fakeVeritas();
    // A token without config:read: Veritas answers 403 for suites only.
    const scoped = Bun.serve({
      port: 0,
      fetch: (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/api/cli/suites") return Response.json({ error: "Insufficient permissions: requires 'config:read' scope" }, { status: 403 });
        return fetch(`${fake.url}${url.pathname}${url.search}`, { headers: request.headers });
      },
    });
    cleanups.push(() => scoped.stop(true), () => fake.stop());
    const proxied = await connect({ endpoint: `http://localhost:${scoped.port}` });
    const result = await call<CockpitData>(proxied.client, "veritas_cockpit");
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent?.suites).toEqual([]);
    expect(result.structuredContent?.suitesError).toBe("Veritas GET /api/cli/suites failed (403): Insufficient permissions: requires 'config:read' scope");
    expect(result.content[0]?.text).toContain("Suites unavailable");
  });
});
