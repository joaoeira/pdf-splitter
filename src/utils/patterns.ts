// Default patterns for chapter detection (case-insensitive, multiline)
export const DEFAULT_PATTERNS: ReadonlyArray<RegExp> = [
  /^chapter\s+(\d+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*|\s+)(.+)?$/im,
  /^part\s+(\d+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*|\s+)(.+)?$/im,
  /^section\s+(\d+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*|\s+)(.+)?$/im,
  /^(\d+)\.\s+([A-Z][^\n]{2,})$/m,
  /^book\s+(\d+|[ivxlcdm]+)(?:\s*[:.\-–—]\s*|\s+)(.+)?$/im,
]

export function extractTitle(match: RegExpMatchArray, fullLine: string): string {
  // Try to extract title from capture groups
  if (match[2] && match[2].trim()) {
    return match[2].trim()
  }
  // Fall back to full matched line
  return fullLine.trim()
}
