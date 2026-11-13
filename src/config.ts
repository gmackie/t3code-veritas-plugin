import { normalizePollingSeconds } from "./veritas.ts";

// The v1 settings map onto these env vars, declared under mcpServer.transport.env
// in t3-plugin.json so T3 collects them at install and stores the token as a secret.
export type VeritasConfig = {
  readonly endpoint: string;
  readonly token?: string;
  readonly defaultSuiteId?: string;
  readonly pollSeconds: number;
};

export const DEFAULT_ENDPOINT = "https://veritas.forgegraf.com";

export function loadConfig(env: Record<string, string | undefined> = process.env): VeritasConfig {
  const token = env.VERITAS_TOKEN?.trim();
  const suite = env.VERITAS_DEFAULT_SUITE_ID?.trim();
  const poll = Number(env.VERITAS_POLL_SECONDS);
  return {
    endpoint: (env.VERITAS_URL?.trim() || DEFAULT_ENDPOINT).replace(/\/+$/u, ""),
    ...(token ? { token } : {}),
    ...(suite ? { defaultSuiteId: suite } : {}),
    pollSeconds: normalizePollingSeconds(env.VERITAS_POLL_SECONDS?.trim() && Number.isFinite(poll) ? poll : undefined),
  };
}
