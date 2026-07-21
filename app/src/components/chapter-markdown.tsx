import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const MARKDOWN_COMPONENTS: Components = {
  h1({ children }) {
    return <h2>{children}</h2>;
  },
  img({ alt }) {
    return alt ? <span className="chapter-markdown__image-alt">{alt}</span> : null;
  },
};

const REMARK_PLUGINS = [remarkGfm];

interface ChapterMarkdownProps {
  readonly prose: string;
}

export const ChapterMarkdown = memo(function ChapterMarkdown({ prose }: ChapterMarkdownProps) {
  return (
    <div className="chapter-markdown">
      <Markdown components={MARKDOWN_COMPONENTS} remarkPlugins={REMARK_PLUGINS} skipHtml>
        {prose}
      </Markdown>
    </div>
  );
});
