import { buildReviewWorkflow } from "../veritas.ts";
import { toolData } from "./bridge.ts";
import { renderReview, type RerunTarget, type ReviewData } from "./render.ts";
import { errorText, startView } from "./shared.client.ts";

const bridge = startView("veritas-evidence-review");
const root = document.getElementById("app")!;
let data: ReviewData | undefined;
let args: Record<string, unknown> = {};
// Approval is this human's click in this view. It is never stored or sent to
// the agent: veritas_run_start is app-only, so only the view can start a run.
let approved = false;
let busy = false;
let error: string | undefined;
let target: Partial<RerunTarget> = {};
let timer: ReturnType<typeof setTimeout> | undefined;

function draw() {
  if (!data) return;
  const workflow = buildReviewWorkflow(data.snapshot, { approved: approved || Boolean(data.startedRun), executionRequested: Boolean(data.startedRun) });
  root.innerHTML = renderReview(data, workflow, { busy, ...(error ? { error } : {}), target });
  clearTimeout(timer);
  // Keep checking a started run until Veritas reports a terminal status. A
  // failed check (run not found, Veritas down) stops polling; Refresh retries.
  if (data.startedRun && !data.settled && !error && !busy) timer = setTimeout(() => void refresh(), data.pollSeconds * 1000);
}

async function run(task: () => Promise<void>) {
  busy = true;
  error = undefined;
  draw();
  try {
    await task();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  busy = false;
  draw();
}

const load = (input: Record<string, unknown>) =>
  run(async () => {
    args = input;
    data = toolData<ReviewData>(await bridge.callTool("veritas_evidence_review", input));
  });

const refresh = () => load({ ...args, ...(data?.suiteId ? { suiteId: data.suiteId } : {}), ...(data?.startedRun ? { startedRunId: data.startedRun.id } : {}) });

const field = (name: keyof RerunTarget) => root.querySelector<HTMLInputElement>(`[data-field=${name}]`)?.value.trim() ?? "";

root.addEventListener("change", (event) => {
  const select = event.target as HTMLSelectElement;
  if (select.dataset.role !== "target" || !data) return;
  target = data.targets[Number(select.value)] ?? {};
  draw();
});

root.addEventListener("click", (event) => {
  const action = (event.target as HTMLElement).closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!action || !data) return;
  if (action === "refresh") void refresh();
  if (action === "approve") {
    approved = true;
    draw();
  }
  if (action === "execute") {
    const input = { suiteId: field("suiteId"), stationId: field("stationId"), deviceId: field("deviceId") };
    target = input;
    if (!input.suiteId || !input.stationId || !input.deviceId) {
      error = "Suite, station and device ids are all required to start a run.";
      draw();
      return;
    }
    void run(async () => {
      const started = toolData<{ runId: string }>(await bridge.callTool("veritas_run_start", input));
      args = { suiteId: input.suiteId, startedRunId: started.runId };
      data = toolData<ReviewData>(await bridge.callTool("veritas_evidence_review", args));
    });
  }
});

bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  if (result.isError) {
    root.textContent = errorText(result, "Evidence review failed to load.");
    return;
  }
  data = toolData<ReviewData>(result);
  draw();
};
void bridge.connect().then(() => setTimeout(() => void (data ? undefined : load(args)), 250));
