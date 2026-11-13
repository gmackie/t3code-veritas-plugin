// Test fixtures: a fake Veritas CLI API on a local port and an MCP client
// connected in-memory to the server, which talks to the fake over real HTTP.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createVeritasMcpServer } from "./server.ts";
import { createVeritasClient } from "./veritas.ts";

export const TOKEN = "vrt_test_secret";

export function fakeVeritas(options: { fail?: number; delayMs?: number } = {}) {
  const started: { suiteId: string; stationId: string; deviceId: string }[] = [];
  const requests: string[] = [];
  const runs = [
    { id: "run-fail-1", status: "failed", testSuiteId: "s1", suiteName: "Smoke <fw>", stationId: "st1", stationName: "Bench A", deviceId: "d1", deviceSerial: "SN-1", triggeredBy: "cli", startedAt: "2026-11-12T10:00:00.000Z", completedAt: "2026-11-12T10:05:00.000Z" },
    { id: "run-pass-2", status: "passed", testSuiteId: "s1", suiteName: "Smoke <fw>", stationId: "st1", stationName: "Bench A", deviceId: "d2", deviceSerial: "SN-2", triggeredBy: "schedule", startedAt: "2026-11-12T09:00:00.000Z", completedAt: "2026-11-12T09:04:00.000Z" },
  ];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push(`${request.method} ${url.pathname}${url.search}`);
      if (options.delayMs) await Bun.sleep(options.delayMs);
      if (request.headers.get("authorization") !== `Bearer ${TOKEN}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (options.fail) return new Response(`stack trace at ${url.href}`, { status: options.fail });
      if (url.pathname === "/api/cli/status")
        return Response.json({
          families: [{ id: "f1", name: "Sensor board", slug: "sensor", activeFirmwareVersion: "1.4.2", healthSummary: { status: "healthy" } }],
          activeRuns: started.map((run, index) => ({ id: `run-new-${index + 1}`, status: "running", testSuiteId: run.suiteId, testStationId: run.stationId, deviceId: run.deviceId })),
          stations: { total: 2, online: 1 },
        });
      if (url.pathname === "/api/cli/runs" && request.method === "GET") {
        const suiteId = url.searchParams.get("suiteId");
        const status = url.searchParams.get("status");
        return Response.json({ runs: runs.filter((run) => (!suiteId || run.testSuiteId === suiteId) && (!status || run.status === status)) });
      }
      if (url.pathname === "/api/cli/suites") return Response.json({ suites: [{ id: "s1", name: "Smoke <fw>", totalRuns: 2, lastRunAt: "2026-11-12T10:00:00.000Z" }] });
      const trigger = url.pathname.match(/^\/api\/cli\/suites\/([^/]+)\/run$/);
      if (trigger && request.method === "POST") {
        const body = (await request.json()) as { stationId?: string; deviceId?: string };
        if (!body.stationId) return Response.json({ error: "stationId is required" }, { status: 400 });
        if (!body.deviceId) return Response.json({ error: "deviceId is required" }, { status: 400 });
        started.push({ suiteId: decodeURIComponent(trigger[1]!), stationId: body.stationId, deviceId: body.deviceId });
        return Response.json({ runId: `run-new-${started.length}`, status: "pending" });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });
  return { url: `http://localhost:${server.port}`, started, requests, stop: () => server.stop(true) };
}

export async function connectedClient(options: { endpoint?: string; token?: string | null; defaultSuiteId?: string; timeoutMs?: number } = {}) {
  const fake = options.endpoint ? undefined : fakeVeritas();
  const endpoint = options.endpoint ?? fake!.url;
  const server = createVeritasMcpServer({
    client: options.token === null ? null : createVeritasClient({ endpoint, token: options.token ?? TOKEN, ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) }),
    ...(options.defaultSuiteId ? { defaultSuiteId: options.defaultSuiteId } : {}),
    pollSeconds: 30,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return {
    client,
    fake,
    async close() {
      await client.close();
      fake?.stop();
    },
  };
}

export type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
export const call = async <T = Record<string, unknown>>(client: Client, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;
