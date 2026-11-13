import { createViewBridge, type HostContext, type ViewBridge } from "./bridge.ts";

// host-context-changed may carry only the changed fields, so merge them.
export function startView(name: string): ViewBridge {
  const bridge = createViewBridge(window as never, { name, version: "0.3.0" });
  let context: HostContext = {};
  bridge.onHostContext = (update) => {
    context = { ...context, ...update };
    if (context.theme) document.documentElement.dataset.theme = context.theme;
  };
  new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);
  return bridge;
}

export const errorText = (result: { content?: readonly { type: string; text?: string }[] }, fallback: string) =>
  result.content?.find((part) => part.type === "text")?.text ?? fallback;
