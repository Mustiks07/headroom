import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export type AiProvider = "anthropic" | "basisweb";
export const BASISWEB_BASE_URL = "https://api.basisweb.ru";
export const BASISWEB_MODELS = new Set(["claude-opus-5.5", "claude-sonnet-5.5", "claude-haiku-5.5"]);

/** Fixed provider destinations: callers cannot supply an arbitrary credential recipient. */
export function createAiClient(config: { provider?: AiProvider; apiKey: string; timeoutMs?: number }) {
  return new Anthropic({
    ...(config.provider === "basisweb"
      ? { baseURL: BASISWEB_BASE_URL, apiKey: null, authToken: config.apiKey }
      : { baseURL: "https://api.anthropic.com", apiKey: config.apiKey, authToken: null }),
    timeout: config.timeoutMs ?? 40_000, maxRetries: 0,
  });
}
