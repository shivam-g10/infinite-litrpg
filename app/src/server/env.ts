import "server-only";

import { config } from "dotenv";
import { resolve } from "node:path";

const ROOT_ENV_PATH = resolve(process.cwd(), "..", ".env");

let loaded = false;

export interface ServerEnvironment {
  readonly openAiApiKey: string | undefined;
  readonly maxBackgroundAgents: number;
  readonly maxCostUsdPerChapter: number;
  readonly nativeMultiAgent: boolean;
}

export function getServerEnvironment(): ServerEnvironment {
  if (!loaded) {
    config({ path: ROOT_ENV_PATH, quiet: true });
    loaded = true;
  }

  return {
    openAiApiKey: process.env.OPENAI_API_KEY,
    maxBackgroundAgents: parseBoundedNumber(process.env.OPENAI_MAX_BACKGROUND_AGENTS, 3, 0, 3),
    maxCostUsdPerChapter: parseBoundedNumber(
      process.env.OPENAI_MAX_COST_USD_PER_CHAPTER,
      0.1,
      0.01,
      3,
    ),
    nativeMultiAgent: process.env.OPENAI_NATIVE_MULTI_AGENT === "true",
  };
}

export function redactSecret(value: string, secret: string | undefined): string {
  if (!secret) {
    return value;
  }

  return value.split(secret).join("[REDACTED]");
}

function parseBoundedNumber(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) && value >= minimum && value <= maximum ? value : fallback;
}
