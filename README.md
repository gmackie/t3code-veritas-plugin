# T3 Code Veritas plugin

Install this directory in T3 Code and sign in to Veritas from **Settings → Tools**. The consent page shows the Default Organization and the read permissions used by the panels. The remote MCP endpoint is `https://veritas.forgegraf.com/api/mcp`.

The project cockpit opens `veritas_cockpit`. The thread panel opens `veritas_evidence_review`. Both use `runs:read`. `config:read` supplies suite details, `stations:read` supplies station availability, and `firmware:read` supplies firmware provenance. Use the Veritas dashboard or the operator server below when you need to start a run.

## Standalone operator server

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

The operator server uses the CLI token configured above. The hosted MCP plugin signs in through T3.
