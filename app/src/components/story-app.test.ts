import { describe, expect, it, vi } from "vitest";

import { readStoryStream } from "./story-app";

describe("readStoryStream", () => {
  it("accepts a committed story stream larger than the former one-megabyte ceiling", async () => {
    const prose = "ember ".repeat(170_000);
    const body = [
      JSON.stringify({ text: prose, type: "chunk" }),
      JSON.stringify({ library: { stories: [] }, story: { chapter: { prose } }, type: "story" }),
      "",
    ].join("\n");
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(1_000_000);
    const onChunk = vi.fn();

    const result = await readStoryStream(
      new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
      onChunk,
    );

    expect(onChunk).toHaveBeenCalledOnce();
    expect(onChunk).toHaveBeenCalledWith(prose);
    expect(result).toMatchObject({ story: { chapter: { prose } } });
  });
});
