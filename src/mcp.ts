#!/usr/bin/env bun
// Stdio entry point for the MCP-native Veritas plugin (manifest v2 `mcpServer`).
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { loadConfig } from "./config.ts";
import { createVeritasMcpServer } from "./server.ts";
import { createVeritasClient } from "./veritas.ts";

const config = loadConfig();
// Without a token the server still starts, so panels load and every tool
// explains what to configure instead of the plugin failing to launch.
const server = createVeritasMcpServer({
  client: config.token ? createVeritasClient({ endpoint: config.endpoint, token: config.token }) : null,
  ...(config.defaultSuiteId ? { defaultSuiteId: config.defaultSuiteId } : {}),
  pollSeconds: config.pollSeconds,
});
await server.connect(new StdioServerTransport());
