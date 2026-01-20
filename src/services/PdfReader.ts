import { Context, Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform"
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs"
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist"
import { PdfNotFoundError, PdfReadError } from "../domain/errors.js"

export interface TextItem {
  readonly text: string
  readonly x: number
  readonly y: number
  readonly height: number
}

export interface OutlineItem {
  readonly title: string
  readonly pageNumber: number
  readonly depth: number
}

export interface PdfDocument {
  readonly path: string
  readonly pageCount: number
  readonly outline: ReadonlyArray<OutlineItem> | null
  readonly getPageTextItems: (pageNumber: number) => Effect.Effect<ReadonlyArray<TextItem>, PdfReadError>
  readonly getPageHeight: (pageNumber: number) => Effect.Effect<number, PdfReadError>
  readonly bytes: Uint8Array
}

export class PdfReader extends Context.Tag("PdfReader")<
  PdfReader,
  {
    readonly load: (path: string) => Effect.Effect<
      PdfDocument,
      PdfNotFoundError | PdfReadError,
      FileSystem.FileSystem
    >
  }
>() {}

// Type for pdfjs text item (not exported from pdfjs-dist)
interface PdfJsTextItem {
  str: string
  transform: number[]
}

type RawOutlineItem = { title: string; dest: unknown; items?: RawOutlineItem[] }

async function resolveOutline(
  rawOutline: RawOutlineItem[] | null,
  pdfDoc: PDFDocumentProxy,
  pageCount: number
): Promise<OutlineItem[]> {
  if (!rawOutline || rawOutline.length === 0) return []

  const items: OutlineItem[] = []

  async function processItems(rawItems: RawOutlineItem[], depth: number): Promise<void> {
    for (const item of rawItems) {
      if (!item.title) continue

      let pageNumber: number | null = null

      if (item.dest) {
        try {
          const dest = typeof item.dest === "string"
            ? await pdfDoc.getDestination(item.dest)
            : item.dest

          if (dest && Array.isArray(dest) && dest[0]) {
            const pageIndex = await pdfDoc.getPageIndex(dest[0])
            pageNumber = pageIndex + 1
          }
        } catch {
          // skip items with unresolvable destinations
        }
      }

      if (pageNumber && pageNumber >= 1 && pageNumber <= pageCount) {
        items.push({ title: item.title.trim(), pageNumber, depth })
      }

      if (item.items && item.items.length > 0) {
        await processItems(item.items, depth + 1)
      }
    }
  }

  await processItems(rawOutline, 0)
  return items.sort((a, b) => a.pageNumber - b.pageNumber)
}

function isTextItem(item: unknown): item is PdfJsTextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    "str" in item &&
    "transform" in item &&
    typeof (item as Record<string, unknown>).str === "string" &&
    Array.isArray((item as Record<string, unknown>).transform)
  )
}

export const PdfReaderLive = Layer.succeed(PdfReader, {
  load: (path) => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const exists = yield* fs.exists(path).pipe(
      Effect.mapError((e) => new PdfReadError({ path, reason: String(e) }))
    )
    if (!exists) {
      return yield* new PdfNotFoundError({ path })
    }

    const bytesRaw = yield* fs.readFile(path).pipe(
      Effect.mapError((e) => new PdfReadError({ path, reason: String(e) }))
    )

    const bytes = new Uint8Array(bytesRaw)

    const pdfDoc = yield* Effect.tryPromise({
      try: () => pdfjsLib.getDocument({ data: bytes }).promise,
      catch: (e) => new PdfReadError({ path, reason: String(e) })
    })

    const rawOutline = yield* Effect.tryPromise({
      try: () => pdfDoc.getOutline() as Promise<RawOutlineItem[] | null>,
      catch: () => null as never
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))

    const outline = yield* Effect.tryPromise({
      try: () => resolveOutline(rawOutline, pdfDoc, pdfDoc.numPages),
      catch: () => null as never
    }).pipe(Effect.catchAll(() => Effect.succeed(null)))

    const pageCache = new Map<number, PDFPageProxy>()

    const getPage = (pageNumber: number): Effect.Effect<PDFPageProxy, PdfReadError> =>
      Effect.gen(function* () {
        const cached = pageCache.get(pageNumber)
        if (cached) return cached

        const page = yield* Effect.tryPromise({
          try: () => pdfDoc.getPage(pageNumber),
          catch: (e) => new PdfReadError({ path, reason: `Page ${pageNumber}: ${e}` })
        })
        pageCache.set(pageNumber, page)
        return page
      })

    return {
      path,
      pageCount: pdfDoc.numPages,
      outline,
      bytes,

      getPageHeight: (pageNumber: number) =>
        Effect.gen(function* () {
          const page = yield* getPage(pageNumber)
          return page.getViewport({ scale: 1 }).height
        }),

      getPageTextItems: (pageNumber: number) =>
        Effect.gen(function* () {
          const page = yield* getPage(pageNumber)
          const viewport = page.getViewport({ scale: 1 })

          const textContent = yield* Effect.tryPromise({
            try: () => page.getTextContent(),
            catch: (e) => new PdfReadError({ path, reason: `Text extraction: ${e}` })
          })

          const result: TextItem[] = []
          for (const item of textContent.items) {
            if (isTextItem(item)) {
              result.push({
                text: item.str,
                x: item.transform[4] ?? 0,
                y: viewport.height - (item.transform[5] ?? 0),
                height: item.transform[0] ?? 12
              })
            }
          }
          return result
        })
    }
  })
})
