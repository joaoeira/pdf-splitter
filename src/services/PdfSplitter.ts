import { Context, Effect, Layer } from "effect"
import { FileSystem, Path } from "@effect/platform"
import { PDFDocument } from "pdf-lib"
import type { Chapter } from "../domain/Chapter.js"
import {
  InvalidChapterRangeError,
  OutputDirectoryError,
  PdfReadError,
  PdfWriteError
} from "../domain/errors.js"
import type { PdfDocument } from "./PdfReader.js"

export class PdfSplitter extends Context.Tag("PdfSplitter")<
  PdfSplitter,
  {
    readonly split: (
      doc: PdfDocument,
      chapters: ReadonlyArray<Chapter>,
      outputDir: string
    ) => Effect.Effect<
      ReadonlyArray<string>,
      OutputDirectoryError | PdfWriteError | InvalidChapterRangeError | PdfReadError,
      FileSystem.FileSystem | Path.Path
    >
  }
>() {}

export const PdfSplitterLive = Layer.succeed(PdfSplitter, {
  split: (doc, chapters, outputDir) => Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    for (const chapter of chapters) {
      if (chapter.endPage < chapter.startPage) {
        return yield* new InvalidChapterRangeError({
          chapter: chapter.title,
          startPage: chapter.startPage,
          endPage: chapter.endPage
        })
      }
      if (chapter.startPage < 1 || chapter.endPage > doc.pageCount) {
        return yield* new InvalidChapterRangeError({
          chapter: chapter.title,
          startPage: chapter.startPage,
          endPage: chapter.endPage
        })
      }
    }

    yield* fs.makeDirectory(outputDir, { recursive: true }).pipe(
      Effect.mapError((e) => new OutputDirectoryError({
        path: outputDir,
        reason: String(e)
      }))
    )

    const pdfBytesRaw = yield* fs.readFile(doc.path).pipe(
      Effect.mapError((e) => new PdfReadError({ path: doc.path, reason: String(e) }))
    )
    const pdfBytes = new Uint8Array(pdfBytesRaw)

    const sourcePdf = yield* Effect.tryPromise({
      try: () => PDFDocument.load(pdfBytes, { ignoreEncryption: true }),
      catch: (e) => new PdfReadError({ path: doc.path, reason: String(e) })
    })

    const createdFiles: string[] = []

    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!
      const chapterPdf = yield* Effect.tryPromise({
        try: () => PDFDocument.create(),
        catch: (e) => new PdfWriteError({ chapter: chapter.title, reason: String(e) })
      })

      const pageIndices = Array.from(
        { length: chapter.endPage - chapter.startPage + 1 },
        (_, i) => chapter.startPage - 1 + i
      )

      const pages = yield* Effect.tryPromise({
        try: () => chapterPdf.copyPages(sourcePdf, pageIndices),
        catch: (e) => new PdfWriteError({ chapter: chapter.title, reason: String(e) })
      })

      for (const page of pages) {
        chapterPdf.addPage(page)
      }

      const metadata = sourcePdf.getTitle()
      if (metadata) {
        chapterPdf.setTitle(`${metadata} - ${chapter.title}`)
      } else {
        chapterPdf.setTitle(chapter.title)
      }

      const sanitizedTitle = chapter.title
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, "_")
        .substring(0, 50)

      const filename = `chapter-${String(i + 1).padStart(2, "0")}_${sanitizedTitle}.pdf`
      const outputPath = path.join(outputDir, filename)

      const pdfBytes = yield* Effect.tryPromise({
        try: () => chapterPdf.save(),
        catch: (e) => new PdfWriteError({ chapter: chapter.title, reason: String(e) })
      })

      yield* fs.writeFile(outputPath, new Uint8Array(pdfBytes)).pipe(
        Effect.mapError((e) => new PdfWriteError({ chapter: chapter.title, reason: String(e) }))
      )

      createdFiles.push(outputPath)
    }

    return createdFiles
  })
})
