# T3 Code Veritas plugin

The Veritas verification cockpit for T3 Code. It reads the Veritas CLI API for runs, station availability, suites, failures and device-family firmware provenance. It also lets a human approve and start a verification run from an evidence review.

The plugin is an MCP server (`src/mcp.ts`, stdio) described by a v2 manifest (`t3-plugin.json`). Version 0.3.0 removed the managed-app runtime and plugin RPC. T3 builds that only load v1 manifests cannot load this version.

## MCP server

The server is built on the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`). Views are MCP Apps: self-contained `ui://` HTML resources.

| Tool | Visibility | What it does |
|---|---|---|
| `veritas_cockpit` | model, app | Active and recent runs, stations, suites, failures and provenance. Renders `ui://veritas/cockpit.html`. |
| `veritas_evidence_review` | model, app | Evidence review: verification health, failing runs, and the targets a suite can run on. Renders `ui://veritas/evidence-review.html`. |
| `veritas_run_start` | app only | Queues a suite run on a station and device. Only the review view can call it, after a human clicks Approve. |
| `veritas_run_get` | model | One run by id or the id prefix the Veritas CLI prints. |
| `veritas_suites_list` | model | Suites with run counts. |

Panels:

- **Verification summary** (`veritas-cockpit`, project) has Overview, Runs, Suites, Targets, Evidence, Failures and Provenance tabs.
- **Thread verification** (`veritas-thread`, thread) is the evidence review.

### Configuration

| Env var | Old setting | Notes |
|---|---|---|
| `VERITAS_URL` | `veritas.endpoint` | Default `https://veritas.forgegraf.com` |
| `VERITAS_TOKEN` | `veritas.token` | Secret. A `vrt_` CLI token. Reading needs `runs:read` and `config:read`; starting runs needs `runs:trigger`. |
| `VERITAS_DEFAULT_SUITE_ID` | `veritas.project` | Optional default suite filter |
| `VERITAS_POLL_SECONDS` | `veritas.polling-seconds` | View refresh interval, 15–3600, default 60 |

Without `VERITAS_TOKEN` the server still starts, and every tool says what to set.

### Run it

```sh
bun install
bun test                # domain, MCP client, view, AppBridge interop and stdio install tests
bun run typecheck
VERITAS_TOKEN=vrt_… bun run inspect   # MCP Inspector (Apps tab)
```

To use it, install this directory through T3's plugin installer after running `bun install --frozen-lockfile`, then set the token on the connected server. Web, desktop and mobile can open its panels.

See `docs/manifest-v2.md` for the v1 → v2 mapping, the v1 features that were removed and why, and the Veritas routes the plugin calls.
