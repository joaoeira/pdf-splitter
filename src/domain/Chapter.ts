import { Data } from "effect"

export interface Chapter {
  readonly index: number
  readonly title: string
  readonly startPage: number
  readonly endPage: number
  readonly depth: number
  readonly source: "bookmark" | "pattern"
}

export const Chapter = Data.case<Chapter>()

export function buildChapters(
  items: ReadonlyArray<{ title: string; startPage: number; depth: number; source: "bookmark" | "pattern" }>,
  totalPages: number
): ReadonlyArray<Chapter> {
  if (items.length === 0) return []

  const sorted = [...items].sort((a, b) => a.startPage - b.startPage)

  return sorted.map((item, idx) => {
    // Find next item at same or higher level (lower or equal depth number)
    let endPage = totalPages
    for (let i = idx + 1; i < sorted.length; i++) {
      const next = sorted[i]
      if (next && next.depth <= item.depth) {
        endPage = next.startPage - 1
        break
      }
    }
    // If no sibling found, end page is start of next item at any level, or total pages
    if (endPage === totalPages && idx + 1 < sorted.length) {
      const nextAny = sorted[idx + 1]
      if (nextAny) {
        endPage = nextAny.startPage - 1
      }
    }
    endPage = Math.max(item.startPage, endPage)

    return Chapter({
      index: idx,
      title: item.title,
      startPage: item.startPage,
      endPage: endPage,
      depth: item.depth,
      source: item.source
    })
  })
}
