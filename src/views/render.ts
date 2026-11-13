// Pure HTML renderers shared by the ui:// views (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import { isFailing, type CockpitViewModel, type ReviewWorkflowModel, type SurfaceModel, type VeritasFamily, type VeritasRun, type VeritasSnapshot, type VeritasSuite } from "../veritas.ts";

export type CockpitData = {
  snapshot: VeritasSnapshot;
  families: readonly VeritasFamily[];
  suites: readonly VeritasSuite[];
  suitesError?: string;
  view: CockpitViewModel;
  surface: SurfaceModel;
  filter: { suiteId?: string; status?: string; limit?: number };
  pollSeconds: number;
  refreshedAt: string;
};

export type RerunTarget = { suiteId: string; stationId: string; deviceId: string; label: string };

export type ReviewData = {
  snapshot: VeritasSnapshot;
  workflow: ReviewWorkflowModel;
  suiteId?: string;
  startedRun?: VeritasRun;
  /** True once the started run reached a terminal status. */
  settled?: boolean;
  targets: readonly RerunTarget[];
  pollSeconds: number;
  refreshedAt: string;
};

export type CockpitTab = CockpitViewModel["navigation"][number]["id"];

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");
const pill = (label: string, tone: string) => `<span class="pill pill-${esc(tone)}">${esc(label)}</span>`;
const empty = (text: string) => `<li class="empty">${esc(text)}</li>`;

export function runTone(status: string): string {
  if (isFailing({ status })) return "negative";
  if (status === "passed") return "positive";
  if (status === "running") return "active";
  return "neutral";
}

// Station/device pairs seen in recent runs, so a reviewer can re-run a suite
// where it last ran. The CLI API has no station listing for tokens.
export function rerunTargets(snapshot: VeritasSnapshot): RerunTarget[] {
  const seen = new Map<string, RerunTarget>();
  for (const run of [...snapshot.activeRuns, ...snapshot.recentRuns]) {
    if (!run.suiteId || !run.stationId || !run.deviceId) continue;
    const key = `${run.suiteId}|${run.stationId}|${run.deviceId}`;
    if (!seen.has(key)) seen.set(key, { suiteId: run.suiteId, stationId: run.stationId, deviceId: run.deviceId, label: [run.suiteName ?? run.suiteId, run.stationName ?? run.stationId, run.deviceSerial ?? run.deviceId].join(" · ") });
  }
  return [...seen.values()].slice(0, 10);
}

function runRow(run: VeritasRun): string {
  const when = run.startedAt ?? run.createdAt;
  return `<li class="row"><div class="row-main">
  <div class="row-title">${esc(run.suiteName ?? "Suite unknown")}</div>
  <div class="row-meta">${pill(run.status, runTone(run.status))}<span class="mono">${esc(run.id)}</span>${run.stationName ? `<span>${esc(run.stationName)}</span>` : ""}${run.deviceSerial ? `<span>${esc(run.deviceSerial)}</span>` : ""}${when ? `<span>${esc(time(when))}</span>` : ""}</div>
</div></li>`;
}

const list = (label: string, title: string, rows: string[], none: string, count = rows.length) =>
  `<section aria-label="${esc(label)}"><h2>${esc(title)} <span class="count">${count}</span></h2><ul>${rows.length ? rows.join("\n") : empty(none)}</ul></section>`;

function tabBody(data: CockpitData, tab: CockpitTab): string {
  const { snapshot } = data;
  const all = [...snapshot.activeRuns, ...snapshot.recentRuns];
  switch (tab) {
    case "runs":
      return list("Runs", "Active and recent runs", all.map(runRow), "No Veritas runs match.");
    case "suites":
      return data.suitesError
        ? `<section aria-label="Suites"><h2>Suites</h2><p class="error" role="alert">Suites unavailable: ${esc(data.suitesError)}</p></section>`
        : list(
            "Suites",
            "Suites",
            data.suites.map(
              (suite) =>
                `<li class="row"><div class="row-main"><div class="row-title">${esc(suite.name)}</div><div class="row-meta"><span class="mono">${esc(suite.id)}</span><span>${esc(suite.totalRuns)} runs</span>${suite.lastRunAt ? `<span>last ${esc(time(suite.lastRunAt))}</span>` : ""}</div>${suite.description ? `<div class="row-detail">${esc(suite.description)}</div>` : ""}</div></li>`,
            ),
            "No Veritas suites.",
          );
    case "targets": {
      const stations = new Map<string, number>();
      for (const run of all) if (run.stationName) stations.set(run.stationName, (stations.get(run.stationName) ?? 0) + 1);
      return `<section aria-label="Targets"><h2>Stations</h2><p class="metric-line">${esc(snapshot.stationSummary.online)}/${esc(snapshot.stationSummary.total)} online</p>
<div class="metrics">${data.view.targetTabs.map((target) => `<div class="metric"><div class="metric-value">${esc(target.runCount)}</div><div class="metric-title">${esc(target.title)} runs</div></div>`).join("")}</div></section>
${list("Stations in recent runs", "Stations in recent runs", [...stations].map(([name, count]) => `<li class="row"><div class="row-main"><div class="row-title">${esc(name)}</div><div class="row-meta"><span>${esc(count)} runs</span></div></div></li>`), "No station activity in recent runs.")}`;
    }
    case "evidence": {
      const completed = snapshot.recentRuns.filter((run) => run.completedAt || ["passed", "failed", "error", "inconclusive"].includes(run.status));
      return list("Evidence", "Completed runs", completed.map(runRow), "No completed runs yet.");
    }
    case "failures":
      return list("Failures", "Failing runs", snapshot.recentRuns.filter(isFailing).map(runRow), "No failing runs.");
    case "provenance":
      return list(
        "Provenance",
        "Device families",
        data.families.map(
          (family) =>
            `<li class="row"><div class="row-main"><div class="row-title">${esc(family.name)}</div><div class="row-meta">${family.health ? pill(family.health, family.health === "healthy" ? "positive" : "warning") : ""}<span>firmware ${esc(family.activeFirmwareVersion ?? "unknown")}</span>${family.slug ? `<span class="mono">${esc(family.slug)}</span>` : ""}</div></div></li>`,
        ),
        "No device families configured.",
      );
    default: {
      const cards = data.surface.cards
        .map((card) => (card.kind === "metric" ? `<div class="metric metric-${esc(card.status ?? "neutral")}"><div class="metric-value">${esc(card.value)}</div><div class="metric-title">${esc(card.title)}</div></div>` : ""))
        .join("");
      const failures = data.view.overview.recentFailures;
      return `<div class="metrics">${cards}<div class="metric metric-${failures ? "negative" : "positive"}"><div class="metric-value">${esc(failures)}</div><div class="metric-title">Recent failures</div></div></div>
${list("Recent runs", "Recent runs", all.slice(0, 10).map(runRow), "No Veritas runs yet.", all.length)}`;
    }
  }
}

export function renderCockpit(data: CockpitData, tab: CockpitTab = "overview", error?: string): string {
  const nav = data.view.navigation
    .map((item) => `<button type="button" role="tab" data-tab="${esc(item.id)}" aria-selected="${item.id === tab}" class="${item.id === tab ? "tab tab-active" : "tab"}">${esc(item.title)}</button>`)
    .join("");
  const filter = [data.filter.suiteId ? `suite ${data.filter.suiteId}` : "", data.filter.status ? `status ${data.filter.status}` : ""].filter(Boolean).join(" · ");
  return `<header>
  <h1>Verification cockpit</h1>
  <div class="header-meta"><span data-role="status">Refreshed ${esc(time(data.refreshedAt))} · every ${esc(data.pollSeconds)}s</span><button type="button" data-action="refresh">Refresh</button></div>
</header>
${filter ? `<p class="row-detail">Filtered: ${esc(filter)}</p>` : ""}
${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
<nav class="tabs" role="tablist" aria-label="Cockpit sections">${nav}</nav>
${tabBody(data, tab)}`;
}

const stepIcon: Record<ReviewWorkflowModel["steps"][number]["state"], string> = { pending: "○", active: "◐", completed: "●", blocked: "◌", failed: "✕" };

export type ReviewUiState = { busy?: boolean; error?: string; target?: Partial<RerunTarget> };

export function renderReview(data: ReviewData, workflow: ReviewWorkflowModel, ui: ReviewUiState = {}): string {
  const steps = workflow.steps
    .map(
      (step) =>
        `<li class="step step-${esc(step.state)}"><span class="step-icon" aria-hidden="true">${stepIcon[step.state]}</span><div><div class="row-title">${esc(step.title)}</div>${step.detail ? `<div class="row-detail">${esc(step.detail)}</div>` : ""}</div><span class="sr">${esc(step.state)}</span></li>`,
    )
    .join("\n");
  const evidence = (workflow.evidence ?? [])
    .map((item) => `<li class="row"><div class="row-main"><div class="row-title">${esc(item.title)}</div><div class="row-meta">${pill(item.status, item.status)}${item.detail ? `<span>${esc(item.detail)}</span>` : ""}</div></div></li>`)
    .join("\n");
  const failing = data.snapshot.recentRuns.filter(isFailing).slice(0, 8).map(runRow);
  const disabled = ui.busy ? " disabled" : "";
  const target = ui.target ?? {};
  const actions = (workflow.actions ?? [])
    .map((action) => {
      if (action.id !== "execute") return `<button type="button" class="primary" data-action="${esc(action.id)}"${disabled}>${esc(action.title)}</button>`;
      const options = data.targets.map((option, index) => `<option value="${index}">${esc(option.label)}</option>`).join("");
      return `<div class="form">
${data.targets.length ? `<label class="field">Recent target <select data-role="target"><option value="">Choose…</option>${options}</select></label>` : `<p class="row-detail">No recent run names a station and device for this suite. Enter their ids from Veritas.</p>`}
<label class="field">Suite <input data-field="suiteId" value="${esc(target.suiteId ?? data.suiteId ?? "")}" autocomplete="off"></label>
<label class="field">Station <input data-field="stationId" value="${esc(target.stationId ?? "")}" autocomplete="off"></label>
<label class="field">Device <input data-field="deviceId" value="${esc(target.deviceId ?? "")}" autocomplete="off"></label>
<button type="button" class="primary" data-action="execute"${disabled}>${esc(action.title)}</button>
</div>`;
    })
    .join("");
  const started = data.startedRun
    ? `<p class="subject">Started run <span class="mono">${esc(data.startedRun.id)}</span> ${pill(data.startedRun.status, runTone(data.startedRun.status))}${data.settled ? "" : ` <span class="row-detail">checking every ${esc(data.pollSeconds)}s</span>`}</p>`
    : "";
  return `<header>
  <h1>${esc(workflow.title)}</h1>
  <div class="header-meta"><span>Stage: <strong data-role="stage">${esc(workflow.currentStage)}</strong></span><button type="button" data-action="refresh"${disabled}>Refresh</button></div>
</header>
${data.suiteId ? `<p class="row-detail">Suite <span class="mono">${esc(data.suiteId)}</span></p>` : ""}
${started}
${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
<ol class="steps">${steps}</ol>
${evidence ? `<section aria-label="Evidence"><h2>Evidence</h2><ul>${evidence}</ul></section>` : ""}
${failing.length ? `<section aria-label="Failing runs"><h2>Failing runs <span class="count">${failing.length}</span></h2><ul>${failing.join("\n")}</ul></section>` : ""}
${actions ? `<div class="actions">${actions}</div>` : ""}`;
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; --warn: #9a6700; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); flex-wrap: wrap; }
ul, ol { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.row-detail { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; }
.count { font-weight: 400; } .empty { color: var(--muted); padding: 8px 0; border-top: 1px solid var(--line); }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; }
.pill-active { color: var(--accent); } .pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-warning { color: var(--warn); } .pill-neutral, .pill-muted { color: var(--muted); }
button, select { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
input { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; min-width: 0; flex: 1; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 10px; } .tab { border-color: transparent; color: var(--muted); } .tab-active { border-color: var(--line); color: var(--fg); font-weight: 500; }
.metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; margin-top: 12px; }
.metric { border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; } .metric-value { font-size: 18px; font-weight: 600; } .metric-title { color: var(--muted); font-size: 12px; }
.metric-positive .metric-value { color: var(--pos); } .metric-warning .metric-value { color: var(--warn); } .metric-negative .metric-value { color: var(--neg); }
.metric-line { margin: 0; }
.steps { margin-top: 10px; } .step { display: flex; gap: 10px; padding: 6px 0; align-items: flex-start; }
.step-icon { width: 14px; text-align: center; color: var(--muted); } .step-active .step-icon { color: var(--accent); } .step-completed .step-icon { color: var(--pos); } .step-failed .step-icon { color: var(--neg); }
.step-pending .row-title { color: var(--muted); font-weight: 400; }
.actions { margin-top: 14px; } .form { display: flex; flex-direction: column; gap: 6px; max-width: 420px; }
.field { display: flex; gap: 6px; align-items: center; color: var(--muted); } .field select { flex: 1; min-width: 0; }
.subject { margin: 6px 0 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.error { color: var(--neg); } .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
