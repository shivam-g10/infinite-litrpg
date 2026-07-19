import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export function GET() {
  const environment = getServerEnvironment();

  return Response.json({
    apiKeyConfigured: environment.openAiApiKey !== undefined,
    maxBackgroundAgents: environment.maxBackgroundAgents,
    maxCostUsdPerChapter: environment.maxCostUsdPerChapter,
    nativeMultiAgent: environment.nativeMultiAgent,
  });
}
