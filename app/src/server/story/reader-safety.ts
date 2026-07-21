const INTERNAL_BRACKET_PATTERN =
  /\s*\[(?:required\s+by\s+chapter\s+\d+|internal\s+milestone\s*:[^\]\n]+|planning\s+phase\s*:[^\]\n]+|scheduled\s+beat\s*:[^\]\n]+|act\s*:\s*\d+)\]\s*/giu;
const INTERNAL_INLINE_PATTERN = /\b(?:required\s+by\s+chapter\s+\d+|due\s+by\s+chapter\s+\d+)\b/giu;

/** Last-mile guard for old saved prose. New prose is rejected before commit. */
export function sanitizeReaderProse(prose: string): string {
  return prose
    .replace(INTERNAL_BRACKET_PATTERN, " ")
    .replace(INTERNAL_INLINE_PATTERN, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/ +\n/gu, "\n")
    .trim();
}
