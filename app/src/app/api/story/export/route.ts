import { getStoryRuntime } from "@/server/story/runtime";
import { storyErrorResponse } from "@/server/story/story-http";
import { StoryServiceError } from "@/server/story/story-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const parameters = new URL(request.url).searchParams;
    const format = parameters.get("format");
    const scope = parameters.get("scope") === "god" ? "god" : "reader";
    const runtime = await getStoryRuntime();
    const storyId = parameters.get("storyId") ?? runtime.workspace.getActiveStoryMetadata()?.id;
    if (storyId === undefined) throw new StoryServiceError("No active story exists", 404);
    const filename = storyId.replace(/[^a-z0-9-]/gu, "-");
    if (format === "json") {
      return download(
        await runtime.workspace.exportJson(storyId, scope),
        "application/json",
        scope === "god" ? `${filename}-developer.json` : `${filename}-reader.json`,
      );
    }
    if (format === "markdown") {
      return download(
        await runtime.workspace.exportMarkdown(storyId),
        "text/markdown; charset=utf-8",
        `${filename}.md`,
      );
    }
    return Response.json({ error: "Format must be markdown or json" }, { status: 400 });
  } catch (error) {
    return storyErrorResponse(error);
  }
}

function download(body: string, contentType: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": contentType,
    },
  });
}
