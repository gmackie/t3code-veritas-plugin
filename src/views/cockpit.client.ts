import { toolData } from "./bridge.ts";
import { renderCockpit, type CockpitData, type CockpitTab } from "./render.ts";
import { errorText, startView } from "./shared.client.ts";

const bridge = startView("veritas-cockpit");
const root = document.getElementById("app")!;
let data: CockpitData | undefined;
let args: Record<string, unknown> = {};
let tab: CockpitTab = "overview";
let error: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function draw() {
  if (!data) return;
  root.innerHTML = renderCockpit(data, tab, error);
  clearTimeout(timer);
  timer = setTimeout(() => void refresh(), data.pollSeconds * 1000);
}

async function refresh() {
  // Polling pauses while the panel is hidden instead of hitting Veritas.
  if (document.visibilityState === "hidden") {
    clearTimeout(timer);
    timer = setTimeout(() => void refresh(), 5000);
    return;
  }
  try {
    data = toolData<CockpitData>(await bridge.callTool("veritas_cockpit", args));
    error = undefined;
  } catch (cause) {
    error = `Refresh failed: ${cause instanceof Error ? cause.message : cause}`;
    if (!data) root.textContent = error;
  }
  draw();
}

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action], [data-tab]");
  if (!target) return;
  if (target.dataset.tab) {
    tab = target.dataset.tab as CockpitTab;
    draw();
  }
  if (target.dataset.action === "refresh") void refresh();
});

bridge.onToolInput = (input) => {
  args = input;
};
bridge.onToolResult = (result) => {
  if (result.isError) {
    root.textContent = errorText(result, "Veritas cockpit failed to load.");
    return;
  }
  data = toolData<CockpitData>(result);
  error = undefined;
  draw();
};
// The panel's opening tool delivers the first result; fetch if none arrives.
void bridge.connect().then(() => setTimeout(() => void (data ? undefined : refresh()), 250));
