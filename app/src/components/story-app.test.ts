import { describe, expect, it, vi } from "vitest";

import { readStoryStream } from "./story-app";

describe("readStoryStream", () => {
  it("accepts a committed story stream larger than the former one-megabyte ceiling", async () => {
    const prose = "ember ".repeat(170_000);
    const body = [
      JSON.stringify({ status: "generating", type: "status" }),
      JSON.stringify({ type: "heartbeat" }),
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

  it("reports generated-world creation phases", async () => {
    const generation = {
      mode: "create",
      phase: "world-checking",
      storyId: "new-world",
      targetChapter: 1,
    } as const;
    const body = [
      JSON.stringify({ generation, type: "status" }),
      JSON.stringify({ library: { stories: [] }, story: {}, type: "story" }),
      "",
    ].join("\n");
    const onStatus = vi.fn();
    await readStoryStream(
      new Response(body, { headers: { "content-type": "application/x-ndjson" } }),
      undefined,
      onStatus,
    );
    expect(onStatus).toHaveBeenCalledWith(
      expect.objectContaining({ ...generation, events: [], startedAt: null, updatedAt: null }),
    );
  });

  it("rejects malformed creation phases and streams without a final story", async () => {
    const malformed = `${JSON.stringify({ generation: { mode: "create", phase: "inventing", storyId: "bad", targetChapter: 1 }, type: "status" })}\n`;
    await expect(
      readStoryStream(
        new Response(malformed, { headers: { "content-type": "application/x-ndjson" } }),
      ),
    ).rejects.toThrow("status was invalid");
    await expect(
      readStoryStream(
        new Response(`${JSON.stringify({ type: "heartbeat" })}\n`, {
          headers: { "content-type": "application/x-ndjson" },
        }),
      ),
    ).rejects.toThrow("before the committed world arrived");
  });
});
