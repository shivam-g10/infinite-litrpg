import { getServerEnvironment } from "@/server/env";

export const dynamic = "force-dynamic";

export function GET() {
  const environment = getServerEnvironment();

  return Response.json({
    apiKeyConfigured: Boolean(environment.openAiApiKey?.trim()),
    maxBackgroundAgents: environment.maxBackgroundAgents,
    maxCostUsdPerChapter: environment.maxCostUsdPerChapter,
    nativeMultiAgent: environment.nativeMultiAgent,
  });
}
