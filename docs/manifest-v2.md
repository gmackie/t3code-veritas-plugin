# Veritas manifest v2 (T3CODE-75)

`t3-plugin.json` follows the MCP-native plugin design from T3CODE-74, the same shape as the Bob plugin (v0.2.1). T3 loads it into its server-owned MCP registry.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `veritas`.
  - `transport`: stdio, `bun ${pluginRoot}/src/mcp.ts`, with `env` as `McpServerVariable[]`.
  - `VERITAS_TOKEN` is `sensitive`.
- `contributes.panels[]`:
  - `veritas-cockpit` (`scope: project`) renders `ui://veritas/cockpit.html` and opens with `veritas_cockpit`.
  - `veritas-thread` (`scope: thread`) renders `ui://veritas/evidence-review.html` and opens with `veritas_evidence_review`.
- `contributes.commands[]` keep the three v1 commands, each opening a panel.
- `t3Tools` is `[]`: Veritas never calls back into T3.

The plugin starts without a token so its panels still load; every tool then returns an error that says to set `VERITAS_TOKEN`.

## v1 → v2 mapping

The last v1 manifest is at commit c880fe1.

| v1 | v2 |
|---|---|
| `runtime` (managed-app, `bun src/stdio.ts`, plugin RPC) | `mcpServer.transport` (stdio, `bun ${pluginRoot}/src/mcp.ts`) |
| `navigation[veritas.overview … veritas.provenance]` | Tabs in the cockpit view, all fed by `veritas_cockpit` |
| `panels[veritas.project-summary]` (project) | `panels[veritas-cockpit]`, `scope: project` |
| `panels[veritas.thread-run]` (thread.sidePanel) | `panels[veritas-thread]`, `scope: thread` |
| `workflows[veritas.evidence-review]` (thread.main) | Tool `veritas_evidence_review` with its own `ui://` view |
| Action `approve` | A click in the evidence review view. It is local to that view (see below). |
| Action `execute` / command `veritas.trigger-run` | App-only tool `veritas_run_start` (`POST /api/cli/suites/{id}/run`) |
| Command `veritas.refresh` | Command `veritas-refresh` opens the cockpit, which reads Veritas on open and on its refresh timer |
| Command `veritas.open-run` | Command `veritas-open-run` opens the cockpit's runs; agents use `veritas_run_get` |
| RPC `cockpit.status`, `runs.active`, `runs.recent`, `targets.summary` | `veritas_cockpit` (agents get a text summary plus structured content) |
| (none) | `veritas_suites_list`, so agents can find suite ids |
| `settings[veritas.endpoint]` | `VERITAS_URL`, default `https://veritas.forgegraf.com` |
| `settings[veritas.token]` | `VERITAS_TOKEN`, `sensitive` |
| `settings[veritas.project]` | `VERITAS_DEFAULT_SUITE_ID`. The Veritas CLI API scopes data by the token's org and has no project filter, so the closest real filter is a suite. |
| `settings[veritas.polling-seconds]` | `VERITAS_POLL_SECONDS` (15–3600, default 60). The views use it as their refresh interval. |
| `settings[veritas.auto-link]` | Removed, see below |
| `settingsPanels` | T3's plugin install form, built from the `env` titles and descriptions |
| `capabilities.secrets.read` | `sensitive` variable |
| `capabilities.network.connect` | Dropped: the server process makes the network calls, and views go through `tools/call` |
| `capabilities.ui.embed` | Implied by `panels` and tool `_meta.ui.resourceUri` |
| `capabilities.filesystem.read` (project root) | Dropped: the v1 runtime never read project files |
| `capabilities.threads.read`, `events.read` | `t3Tools: []`, see below |
| `hooks` (`turn.settled`, `thread.completed`, `runtime.error`) | Removed, see below |

## Removed v1 features

- **Hooks and automatic run-to-thread linking (`veritas.auto-link`).** v2 has no hooks. The v1 runtime also never handled these events, and Veritas runs carry no T3 thread id that a link could be stored on. An on-demand version through T3 tools would still have nowhere to keep the link, so the feature was dropped instead of faked. The thread panel shows the project's verification state and the review, as the v1 thread panel did.
- **Persisted workflow state.** v1 wrote `approved` and `executionRequested` to `T3_PLUGIN_STATE_FILE`. In v2 a human approves by clicking Approve in the review view, and only that view can call `veritas_run_start` (`visibility: ["app"]`). The approval never leaves the view, so no state file is shared between plugin copies. A started run is followed by passing its id back to `veritas_evidence_review` (`startedRunId`).
- **The in-process polling coordinator.** Each tool call reads Veritas directly. Views refresh every `VERITAS_POLL_SECONDS` and pause while hidden.

## Server rules

- **Visibility:**
  - `veritas_cockpit` and `veritas_evidence_review` are `["model", "app"]`.
  - `veritas_run_start` is `["app"]`. Starting a run occupies a physical station, so only a human in the review view can start one.
  - `veritas_run_get` and `veritas_suites_list` are agent tools with no UI.
- **Stateless processes.** T3 runs one stdio copy per agent session plus one in its pool. The server keeps nothing in memory between calls.
- **Network:**
  - Every request has a 15s timeout.
  - A 5xx answer becomes `Veritas is temporarily unavailable (status)`, and a 401 says to check `VERITAS_TOKEN`.
  - Other 4xx answers pass on Veritas's short `error` message, for example a missing `runs:trigger` scope.
  - Endpoint URLs and response bodies are never put in tool results.

## Veritas API used

These are the CLI routes in `veritas/apps/web/app/api/cli`, called with a Bearer `vrt_` token:

| Route | Scope | Used by |
|---|---|---|
| `GET /api/cli/status` | any | `veritas_cockpit`, `veritas_evidence_review` (families, active runs, stations) |
| `GET /api/cli/runs?suiteId&status&limit` | `runs:read` | `veritas_cockpit`, `veritas_evidence_review`, `veritas_run_get` |
| `GET /api/cli/suites` | `config:read` | `veritas_cockpit` (Suites tab; reports an error there if missing), `veritas_suites_list` |
| `POST /api/cli/suites/{id}/run` | `runs:trigger` | `veritas_run_start` |

v1's `startRun` posted `{ projectId, targetType }` to `POST /api/cli/runs`. That route uploads finished results and rejects that body, so v2 starts runs through the suite route.

## Open questions

1. **Run detail and artifacts.** `GET /api/runs/{id}` only accepts station tokens. `veritas_run_get` therefore searches the 200 most recent runs. Per-test results and evidence artifacts need a CLI route in Veritas first.
2. **Station and device discovery.** The CLI API has no station or device listing. The review offers the station/device pairs from recent runs of the suite, plus free entry.
3. **Software/hardware split.** The CLI runs route does not return `targetType`. Runs without one count as software in the Targets tab.
