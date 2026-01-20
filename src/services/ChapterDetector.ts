import { Context, Effect, Layer, Option } from "effect"
import { Chapter, buildChapters } from "../domain/Chapter.js"
import { NoChaptersFoundError, PdfReadError } from "../domain/errors.js"
import { DEFAULT_PATTERNS, extractTitle } from "../utils/patterns.js"
import type { PdfDocument, TextItem } from "./PdfReader.js"

interface ChapterCandidate {
  pageNumber: number
  title: string
  matchedLine: string
}

function groupIntoLines(textItems: ReadonlyArray<TextItem>): string[] {
  if (textItems.length === 0) return []

  const sorted = [...textItems].sort((a, b) => {
    const yDiff = a.y - b.y
    if (Math.abs(yDiff) > 5) return yDiff
    return a.x - b.x
  })

  const lines: string[][] = []
  let currentLine: string[] = []
  let currentY = sorted[0]?.y ?? 0

  for (const item of sorted) {
    if (Math.abs(item.y - currentY) > 5) {
      if (currentLine.length > 0) {
        lines.push(currentLine)
      }
      currentLine = []
      currentY = item.y
    }
    currentLine.push(item.text)
  }

  if (currentLine.length > 0) {
    lines.push(currentLine)
  }

  return lines.map(line => line.join(" "))
}

function detectTocPages(candidates: ReadonlyArray<ChapterCandidate>): Set<number> {
  const pageCounts = new Map<number, number>()
  for (const c of candidates) {
    pageCounts.set(c.pageNumber, (pageCounts.get(c.pageNumber) ?? 0) + 1)
  }
  return new Set(
    [...pageCounts.entries()]
      .filter(([, count]) => count >= 3)
      .map(([page]) => page)
  )
}

function applyHeuristics(
  candidates: ReadonlyArray<ChapterCandidate>,
  pageCount: number
): ChapterCandidate[] {
  // H1: Skip TOC pages (pages with 3+ matches)
  const tocPages = detectTocPages(candidates)
  const filtered = candidates.filter(c => !tocPages.has(c.pageNumber))

  // H2: Enforce minimum page gap (at least 2 pages between chapters)
  const MIN_PAGE_GAP = 2
  const deduped: ChapterCandidate[] = []
  for (const candidate of filtered) {
    const lastChapter = deduped[deduped.length - 1]
    if (!lastChapter || candidate.pageNumber - lastChapter.pageNumber >= MIN_PAGE_GAP) {
      deduped.push(candidate)
    }
  }

  // H3: If >50% of pages match, likely running headers - fail gracefully
  if (deduped.length > pageCount * 0.5) {
    return []
  }

  return deduped
}

async function detectFromText(
  doc: PdfDocument,
  patterns: ReadonlyArray<RegExp>
): Promise<{ candidates: ChapterCandidate[]; error?: PdfReadError }> {
  const candidates: ChapterCandidate[] = []

  for (let pageNum = 1; pageNum <= doc.pageCount; pageNum++) {
    const textItemsResult = await Effect.runPromise(
      doc.getPageTextItems(pageNum).pipe(Effect.either)
    )

    if (textItemsResult._tag === "Left") {
      return { candidates: [], error: textItemsResult.left }
    }

    const textItems = textItemsResult.right

    const pageHeightResult = await Effect.runPromise(
      doc.getPageHeight(pageNum).pipe(Effect.either)
    )

    if (pageHeightResult._tag === "Left") {
      return { candidates: [], error: pageHeightResult.left }
    }

    const pageHeight = pageHeightResult.right

    const topRegionItems = textItems.filter(
      item => item.y < pageHeight * 0.20
    )

    const lines = groupIntoLines(topRegionItems)
      .map(line => line.trim())
      .filter(line => line.length > 0)

    const linesToCheck = lines.slice(0, 5)

    for (const line of linesToCheck) {
      let matched = false
      for (const pattern of patterns) {
        const match = line.match(pattern)
        if (match) {
          candidates.push({
            pageNumber: pageNum,
            title: extractTitle(match, line),
            matchedLine: line
          })
          matched = true
          break
        }
      }
      if (matched) break
    }
  }

  return { candidates }
}

export class ChapterDetector extends Context.Tag("ChapterDetector")<
  ChapterDetector,
  {
    readonly detect: (
      doc: PdfDocument,
      customPattern: Option.Option<RegExp>
    ) => Effect.Effect<ReadonlyArray<Chapter>, NoChaptersFoundError | PdfReadError>
  }
>() {}

export const ChapterDetectorLive = Layer.succeed(ChapterDetector, {
  detect: (doc, customPattern) => Effect.gen(function* () {
    if (doc.outline && doc.outline.length > 0) {
      const chapters = buildChapters(
        doc.outline.map(o => ({
          title: o.title,
          startPage: o.pageNumber,
          depth: o.depth,
          source: "bookmark" as const
        })),
        doc.pageCount
      )

      if (chapters.length > 0) {
        return chapters
      }
    }

    const patterns = Option.isSome(customPattern)
      ? [customPattern.value]
      : DEFAULT_PATTERNS

    const { candidates, error } = yield* Effect.promise(() =>
      detectFromText(doc, patterns)
    )

    if (error) {
      return yield* error
    }

    const filteredCandidates = applyHeuristics(candidates, doc.pageCount)

    if (filteredCandidates.length === 0) {
      return yield* new NoChaptersFoundError({
        path: doc.path,
        patternsUsed: patterns.map(p => p.source)
      })
    }

    const chapters = buildChapters(
      filteredCandidates.map(c => ({
        title: c.title,
        startPage: c.pageNumber,
        depth: 0,
        source: "pattern" as const
      })),
      doc.pageCount
    )

    return chapters
  })
})
