# T3 Code Veritas plugin

Reference plugin for the Veritas verification cockpit. It reads Veritas `/api/cli/status` and `/api/cli/runs`, normalizes software and physical verification state, and exposes plugin-owned navigation for overview, runs, suites, targets, evidence, failures, and provenance.

Requested access: explicit Veritas secret access, fixed Veritas network access, project filesystem read, thread/event context, and project/thread UI panels. The plugin owns its cockpit and cache; T3 receives native summary cards and navigation links. Starting or uploading runs remains an explicit capability expansion.
