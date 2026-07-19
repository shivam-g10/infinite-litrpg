import { getStoryRuntime } from "@/server/story/runtime";
import { StoryServiceError } from "@/server/story/story-service";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const format = new URL(request.url).searchParams.get("format");
    const scope = new URL(request.url).searchParams.get("scope") === "god" ? "god" : "reader";
    if (format === "json") {
      return download(
        getStoryRuntime().service.exportJson(scope),
        "application/json",
        scope === "god" ? "ashencrown-god-mode.json" : "ashencrown-reader.json",
      );
    }
    if (format === "markdown") {
      return download(
        getStoryRuntime().service.exportMarkdown(),
        "text/markdown; charset=utf-8",
        "ashencrown.md",
      );
    }
    return Response.json({ error: "Format must be markdown or json" }, { status: 400 });
  } catch (error) {
    if (error instanceof StoryServiceError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Export failed safely" }, { status: 500 });
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
