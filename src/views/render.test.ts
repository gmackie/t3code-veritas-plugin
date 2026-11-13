import { describe, expect, it } from "bun:test";

import { buildCockpitViewModel, buildReviewWorkflow, buildSurfaceModel, type VeritasSnapshot } from "../veritas.ts";
import { renderCockpit, renderReview, rerunTargets, type CockpitData, type ReviewData } from "./render.ts";

const snapshot: VeritasSnapshot = {
  stationSummary: { online: 1, total: 2 },
  projects: [],
  activeRuns: [{ id: "r-active", status: "running", targetType: null, stationName: "Bench A", suiteId: "s1", stationId: "st1", deviceId: "d1" }],
  recentRuns: [
    { id: "r-fail", status: "failed", targetType: null, stationName: "Bench <B>", suiteName: "Smoke <script>alert(1)</script>", completedAt: "2026-11-12T10:00:00Z" },
    { id: "r-pass", status: "passed", targetType: null, stationName: null },
  ],
};

const cockpit = (overrides: Partial<CockpitData> = {}): CockpitData => ({
  snapshot,
  families: [{ id: "f1", name: "Sensor", activeFirmwareVersion: "1.4.2", health: "degraded" }],
  suites: [],
  view: buildCockpitViewModel(snapshot),
  surface: buildSurfaceModel(snapshot),
  filter: {},
  pollSeconds: 60,
  refreshedAt: "2026-11-13T00:00:00Z",
  ...overrides,
});

describe("view renderers", () => {
  it("renders every cockpit section and escapes Veritas content", () => {
    const overview = renderCockpit(cockpit());
    expect(overview).toContain('data-tab="provenance"');
    expect(overview).toContain('aria-selected="true" class="tab tab-active">Overview');
    expect(overview).toContain("Smoke &lt;script&gt;");
    expect(overview).not.toContain("<script>");
    expect(renderCockpit(cockpit(), "failures")).toContain("r-fail");
    expect(renderCockpit(cockpit(), "failures")).not.toContain("r-pass");
    expect(renderCockpit(cockpit(), "evidence")).toContain("r-pass");
    expect(renderCockpit(cockpit(), "targets")).toContain("1/2 online");
    expect(renderCockpit(cockpit(), "targets")).toContain("Bench &lt;B&gt;");
    expect(renderCockpit(cockpit(), "provenance")).toContain("firmware 1.4.2");
    expect(renderCockpit(cockpit({ suitesError: "Forbidden <x>" }), "suites")).toContain('role="alert">Suites unavailable: Forbidden &lt;x&gt;');
    expect(renderCockpit(cockpit({ snapshot: { ...snapshot, activeRuns: [], recentRuns: [] } }), "runs")).toContain("No Veritas runs match.");
  });

  it("offers approve, then a target form, then follows the started run", () => {
    const data: ReviewData = { snapshot, workflow: buildReviewWorkflow(snapshot), targets: rerunTargets(snapshot), pollSeconds: 30, refreshedAt: "2026-11-13T00:00:00Z" };
    expect(data.targets).toEqual([{ suiteId: "s1", stationId: "st1", deviceId: "d1", label: "s1 · Bench A · d1" }]);
    const approve = renderReview(data, buildReviewWorkflow(snapshot));
    expect(approve).toContain('data-action="approve"');
    expect(approve).not.toContain('data-action="execute"');

    const execute = renderReview(data, buildReviewWorkflow(snapshot, { approved: true }), { busy: true, error: "Veritas down", target: { stationId: "st<1>" } });
    expect(execute).toContain('data-action="execute" disabled');
    expect(execute).toContain('value="st&lt;1&gt;"');
    expect(execute).toContain('role="alert">Veritas down');

    const verify = renderReview({ ...data, startedRun: { id: "r-new", status: "pending", targetType: null, stationName: null }, settled: false }, buildReviewWorkflow(snapshot, { approved: true, executionRequested: true }));
    expect(verify).not.toContain('class="actions"');
    expect(verify).toContain("checking every 30s");
  });
});
