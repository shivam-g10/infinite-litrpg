import { PUBLIC_CHARACTERS } from "@infinite-litrpg/shared";

import { StoryApp } from "@/components/story-app";

export default function HomePage() {
  return <StoryApp characters={PUBLIC_CHARACTERS} />;
}
