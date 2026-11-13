import { expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import manifest from "../t3-plugin.json";

it("launches the installed manifest from another directory and serves its panels", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "veritas-install-"));
  const root = new URL("../", import.meta.url).pathname.replace(/\/$/, "");
  // Only the manifest's own variables, with their defaults: no token configured.
  const env = Object.fromEntries(manifest.mcpServer.transport.env.map((variable) => [variable.name, variable.value]));
  const transport = new StdioClientTransport({
    command: manifest.mcpServer.transport.command,
    args: manifest.mcpServer.transport.args.map((arg) => arg.replaceAll("${pluginRoot}", root)),
    cwd,
    env: { ...env, PATH: process.env.PATH ?? "" },
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
