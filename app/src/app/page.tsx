import { StoryApp } from "@/components/story-app";
import { getServerEnvironment } from "@/server/env";

export default function HomePage() {
  return <StoryApp apiKeyConfigured={Boolean(getServerEnvironment().openAiApiKey?.trim())} />;
}
