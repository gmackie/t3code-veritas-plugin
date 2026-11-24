import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import manifest from "../t3-plugin.json";

it("installs the remote verification tool and resource pairs with scoped OAuth", () => {
  expect(manifest.mcpServer.transport).toEqual({
    type: "http",
    url: "https://veritas.forgegraf.com/api/mcp",
    headers: [],
    auth: { type: "oauth", scopes: ["config:read", "runs:read", "stations:read", "firmware:read"] },
  });
  expect(manifest.contributes.panels.map(({ resourceUri, tool }) => [resourceUri, tool.name])).toEqual([
    ["ui://veritas/cockpit.html", "veritas_cockpit"],
    ["ui://veritas/evidence-review.html", "veritas_evidence_review"],
  ]);
});

it("launches the standalone operator server from another directory and serves its panels", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "veritas-install-"));
  const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  const transport = new StdioClientTransport({
    command: "bun",
    args: [join(root, "src/mcp.ts")],
    cwd,
    env: { PATH: process.env.PATH ?? "" },
  });
  const client = new Client({ name: "installation-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    for (const panel of manifest.contributes.panels) expect(tools).toContain(panel.tool.name);
    const resources = (await client.listResources()).resources;
    for (const panel of manifest.contributes.panels) {
      expect(resources.some((resource) => resource.uri === panel.resourceUri)).toBe(true);
      const view = await client.readResource({ uri: panel.resourceUri });
      expect(view.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
      expect(view.contents[0]).toHaveProperty("text", expect.stringContaining("ui/initialize"));
    }
    // An unconfigured install answers with setup guidance rather than data.
    const result = await client.callTool({ name: "veritas_cockpit", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("VERITAS_TOKEN");
  } finally {
    await client.close();
    await rm(cwd, { recursive: true, force: true });
  }
});
