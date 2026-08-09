import { createRpcHandler } from "./rpc.ts";
import { createVeritasClient, type VeritasSnapshot } from "./veritas.ts";

let snapshot = JSON.parse(process.env.T3_PLUGIN_SNAPSHOT ?? '{"stationSummary":{"online":0,"total":0},"projects":[],"activeRuns":[],"recentRuns":[]}') as VeritasSnapshot;
const statePath = process.env.T3_PLUGIN_STATE_FILE;
let workflowState = { approved: false };
if (statePath) {
  try {
    const stored = JSON.parse(await Bun.file(statePath).text()) as { workflowState?: { approved?: boolean } };
    workflowState.approved = stored.workflowState?.approved === true;
  } catch {
    // Missing or invalid plugin state starts from the safe unapproved state.
  }
}
const client = process.env.T3_PLUGIN_ENDPOINT && process.env.T3_PLUGIN_TOKEN
  ? createVeritasClient({ endpoint: process.env.T3_PLUGIN_ENDPOINT, token: process.env.T3_PLUGIN_TOKEN })
  : null;
const refresh = async () => { if (client) snapshot = await client.snapshot(); return snapshot; };
const handler = createRpcHandler({ get snapshot() { return snapshot; }, refresh, workflowState, saveWorkflowState: async () => {
  if (statePath) await Bun.write(statePath, JSON.stringify({ workflowState }));
} });
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line) as { requestId: string; method: string; payload?: { navigationId?: string; panelId?: string; actionId?: string; workflowId?: string; input?: unknown } };
      void handler(request.method, request.payload).then((result) => process.stdout.write(`${JSON.stringify({ type: "plugin.response", requestId: request.requestId, ...result })}\n`));
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ type: "plugin.response", requestId: "unknown", ok: false, error: error instanceof Error ? error.message : "invalid request" })}\n`);
    }
  }
});
