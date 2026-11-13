import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import { rerunTargets, type CockpitData, type ReviewData } from "./views/render.ts";
import { buildCockpitViewModel, buildReviewWorkflow, buildSurfaceModel, isFailing, type VeritasClient, type VeritasRun } from "./veritas.ts";

export const SERVER_INFO = { name: "veritas", version: "0.3.0" } as const;

export type VeritasServerOptions = {
  /** Null when VERITAS_TOKEN is not configured: every tool then explains how to set it. */
  client: VeritasClient | null;
  defaultSuiteId?: string;
  pollSeconds: number;
};

export const MISSING_TOKEN =
  "Veritas is not configured: set VERITAS_TOKEN (a Veritas CLI token, vrt_…) in the plugin's server variables under Settings → Tools → veritas.";

const REVIEW_RUN_WINDOW = 50;
const TERMINAL = new Set(["passed", "failed", "error", "inconclusive", "cancelled", "skipped"]);
const id = (label: string) => z.string().trim().min(1).describe(label);

// Every handler reads Veritas on demand: T3 runs one stdio copy per agent
// session plus a pool copy, so nothing is cached or remembered in-process.
export function createVeritasMcpServer(options: VeritasServerOptions): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Veritas is a software and hardware verification service. Use veritas_cockpit for runs, stations, suites, failures and firmware provenance; veritas_run_get for one run; veritas_suites_list for suite ids. Use veritas_evidence_review to show the review view: only a human can approve and start a verification run there.",
  });

  const client = () => {
    if (!options.client) throw new Error(MISSING_TOKEN);
    return options.client;
  };

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "veritas_cockpit",
    {
      title: "Veritas verification cockpit",
      description:
        "Read Veritas verification state: active and recent runs, station availability, suites, failures and device-family firmware provenance. Renders the verification cockpit.",
      inputSchema: z.object({
        suiteId: z.string().optional().describe("Only runs of this suite; defaults to VERITAS_DEFAULT_SUITE_ID"),
        status: z.string().optional().describe("Only runs with this status, e.g. failed, running, passed"),
        limit: z.number().int().min(1).max(200).optional().describe("Recent runs to read (default 20)"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.cockpit.uri, visibility: ["model", "app"] } },
    },
    async ({ suiteId, status, limit }) =>
      result(async () => {
        const veritas = client();
        const filter = { ...((suiteId ?? options.defaultSuiteId) ? { suiteId: suiteId ?? options.defaultSuiteId } : {}), ...(status ? { status } : {}), ...(limit ? { limit } : {}) };
        const [{ snapshot, families }, suites] = await Promise.all([
          veritas.snapshot(filter),
          veritas.suites().then((suites) => ({ suites }), (error: unknown) => ({ suites: [], suitesError: message(error) })),
        ]);
        const data: CockpitData = {
          snapshot,
          families,
          ...suites,
          view: buildCockpitViewModel(snapshot),
          surface: buildSurfaceModel(snapshot),
          filter,
          pollSeconds: options.pollSeconds,
          refreshedAt: new Date().toISOString(),
        };
        const failing = snapshot.recentRuns.filter(isFailing);
        const lines = [...snapshot.activeRuns, ...snapshot.recentRuns].slice(0, 20).map(runLine);
        return {
          data,
          text: [
            `Veritas: ${snapshot.activeRuns.length} active runs, ${snapshot.recentRuns.length} recent runs (${failing.length} failing), stations ${snapshot.stationSummary.online}/${snapshot.stationSummary.total} online.`,
            data.suitesError ? `Suites unavailable: ${data.suitesError}` : `${data.suites.length} suites.`,
            ...lines,
          ].join("\n"),
        };
      }),
  );

  server.registerTool(
    "veritas_suites_list",
    {
      title: "List Veritas suites",
      description: "List Veritas test suites with run counts. Use a suite id with veritas_cockpit or veritas_evidence_review.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      result(async () => {
        const suites = await client().suites();
        return { data: { suites }, text: suites.map((suite) => `- ${suite.id} ${suite.name} (${suite.totalRuns} runs)`).join("\n") || "No Veritas suites." };
      }),
  );

  server.registerTool(
    "veritas_run_get",
    {
      title: "Get Veritas run",
      description: "Get one Veritas run by id or id prefix (as the Veritas CLI prints it), searched among the 200 most recent runs.",
      inputSchema: z.object({ runId: id("Veritas run id or prefix") }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ runId }) =>
      result(async () => {
        const runs = await client().runs({ limit: 200 });
        const matches = runs.filter((run) => run.id === runId || run.id.startsWith(runId));
        if (matches.length === 0) throw new Error(`No Veritas run ${runId} among the 200 most recent runs.`);
        if (matches.length > 1 && !matches.some((run) => run.id === runId)) throw new Error(`Run id prefix ${runId} matches ${matches.length} runs; use a longer id.`);
        const run = matches.find((candidate) => candidate.id === runId) ?? matches[0]!;
        return { data: { run }, text: JSON.stringify(run, null, 2) };
      }),
  );

  registerAppTool(
    server,
    "veritas_evidence_review",
    {
      title: "Veritas evidence review",
      description:
        "Show the evidence review workflow: verification health, failing runs, and the stations and devices a suite can run on. A human approves and starts a run from the rendered view; pass startedRunId to follow a started run.",
      inputSchema: z.object({
        suiteId: z.string().optional().describe("Suite to review; defaults to VERITAS_DEFAULT_SUITE_ID"),
        startedRunId: z.string().optional().describe("Run started from this review, to verify its result"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.review.uri, visibility: ["model", "app"] } },
    },
    async ({ suiteId, startedRunId }) =>
      result(async () => {
        const suite = suiteId ?? options.defaultSuiteId;
        const { snapshot } = await client().snapshot({ ...(suite ? { suiteId: suite } : {}), limit: REVIEW_RUN_WINDOW });
        const all = [...snapshot.activeRuns, ...snapshot.recentRuns];
        const startedRun = startedRunId ? all.find((run) => run.id === startedRunId) : undefined;
        // Never invent a run: a wrong id, another suite's run, or one older than
        // this window must not show as approved and queued.
        if (startedRunId && !startedRun) throw new Error(`Run ${startedRunId} not found among the ${REVIEW_RUN_WINDOW} most recent runs${suite ? ` of suite ${suite}` : ""}. Check the id, or look it up with veritas_run_get.`);
        const settled = startedRun ? TERMINAL.has(startedRun.status) : false;
        const workflow = buildReviewWorkflow(snapshot, startedRun ? { approved: true, executionRequested: true } : {});
        const data: ReviewData = {
          snapshot,
          workflow,
          ...(suite ? { suiteId: suite } : {}),
          ...(startedRun ? { startedRun, settled } : {}),
          targets: rerunTargets(snapshot),
          pollSeconds: options.pollSeconds,
          refreshedAt: new Date().toISOString(),
        };
        const failing = snapshot.recentRuns.filter(isFailing).length;
        const status = startedRun ? ` Started run ${startedRun.id} is ${startedRun.status}.` : "";
        return {
          data,
          text: `Evidence review${suite ? ` for suite ${suite}` : ""}: stage ${workflow.currentStage}, ${failing} failing of ${snapshot.recentRuns.length} recent runs, stations ${snapshot.stationSummary.online}/${snapshot.stationSummary.total} online.${status} Starting a run needs human approval in the view.`,
        };
      }),
  );

  // App-only: starting a verification run occupies a physical station, so only
  // a human in the evidence review view can do it. T3 hides it from the model.
  server.registerTool(
    "veritas_run_start",
    {
      title: "Start Veritas run",
      description: "Queue a run of a Veritas suite on a station and device. Called by the evidence review view after human approval.",
      inputSchema: z.object({ suiteId: id("Veritas suite id"), stationId: id("Veritas station id"), deviceId: id("Veritas device id") }),
      annotations: { openWorldHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (input) =>
      result(async () => {
        const run = await client().startRun(input);
        return { data: run, text: `Veritas run ${run.runId} queued (${run.status}).` };
      }),
  );

  return server;
}

function runLine(run: VeritasRun): string {
  return `- ${run.id} [${run.status}] ${run.suiteName ?? "suite unknown"} · ${run.stationName ?? "station unknown"}${run.deviceSerial ? ` · ${run.deviceSerial}` : ""}`;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: message(error) }], isError: true };
  }
}
