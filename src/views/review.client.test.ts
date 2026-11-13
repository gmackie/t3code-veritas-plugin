import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";

import { connectedClient } from "../testing.ts";

// Runs the real evidence review view module against a DOM, with this test
// acting as the host frame and forwarding tools/call to the MCP server.
describe("evidence review view in a DOM", () => {
  it("needs a human approval click before it starts a run, then follows it", async () => {
    const { client, fake, close } = await connectedClient();
    const win = new Window({ url: "https://view.invalid/" });
    const calls: string[] = [];
    const deliver = (data: unknown) => win.dispatchEvent(new win.MessageEvent("message", { data, source: parent as never }));
    const parent = {
      async postMessage(message: { id?: number; method?: string; params?: { name: string; arguments: Record<string, unknown> } }) {
        if (message.method === "ui/initialize") deliver({ jsonrpc: "2.0", id: message.id, result: { hostContext: { theme: "dark", t3: { threadId: "t1" } } } });
        if (message.method === "tools/call") {
          calls.push(message.params!.name);
          deliver({ jsonrpc: "2.0", id: message.id, result: await client.callTool({ name: message.params!.name, arguments: message.params!.arguments }) });
        }
      },
    };
    Object.defineProperty(win, "parent", { value: parent });
    win.document.body.innerHTML = `<main id="app">Loading…</main>`;
    Object.assign(globalThis, { window: win, document: win.document, ResizeObserver: class { observe() {} } });

    try {
      await import("./review.client.ts");
      await Bun.sleep(5);
      deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { suiteId: "s1" } } });
      deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: await client.callTool({ name: "veritas_evidence_review", arguments: { suiteId: "s1" } }) });
      const doc = win.document;
      const settle = () => Bun.sleep(40);
      const click = (selector: string) => (doc.querySelector(selector) as unknown as HTMLElement).click();
      await settle();
      expect(doc.documentElement.dataset.theme).toBe("dark");
      expect(doc.querySelector("[data-role=stage]")?.textContent).toBe("review");
      expect(doc.querySelector("[data-action=execute]")).toBeNull();

      click("[data-action=approve]");
      await settle();
      expect(doc.querySelector("[data-role=stage]")?.textContent).toBe("execute");
      expect(fake!.started).toEqual([]);

      // Missing ids are caught in the view, not sent to Veritas.
      click("[data-action=execute]");
      await settle();
      expect(doc.querySelector("[role=alert]")?.textContent).toContain("are all required");

      const select = doc.querySelector("[data-role=target]") as unknown as HTMLSelectElement;
      select.value = "1";
      select.dispatchEvent(new win.Event("change", { bubbles: true }) as never);
      await settle();
      expect((doc.querySelector("[data-field=deviceId]") as unknown as HTMLInputElement).value).toBe("d2");

      click("[data-action=execute]");
      await settle();
      expect(fake!.started).toEqual([{ suiteId: "s1", stationId: "st1", deviceId: "d2" }]);
      expect(doc.querySelector("[data-role=stage]")?.textContent).toBe("verify");
      expect(doc.body.textContent).toContain("run-new-1");
      expect(calls).toEqual(["veritas_run_start", "veritas_evidence_review"]);
    } finally {
      await close();
      await win.happyDOM.close();
    }
  });
});
