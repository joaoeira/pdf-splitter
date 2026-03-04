import { Args, Command, Options, Prompt } from "@effect/cli"
import { Effect, Option, Console } from "effect"
import { PdfReader } from "../services/PdfReader.js"
import { ChapterDetector } from "../services/ChapterDetector.js"
import { PdfSplitter } from "../services/PdfSplitter.js"
import type { Chapter } from "../domain/Chapter.js"

const pdfFile = Args.file({ name: "pdf", exists: "yes" }).pipe(
  Args.withDescription("Path to the input PDF file")
)

const outputDir = Args.directory({ name: "output", exists: "either" }).pipe(
  Args.withDescription("Output directory for split chapters")
)

const patternOption = Options.text("pattern").pipe(
  Options.withAlias("p"),
  Options.withDescription("Custom regex pattern for chapter detection (case-insensitive)"),
  Options.optional
)

const filterOption = Options.text("filter").pipe(
  Options.withAlias("f"),
  Options.withDescription("Filter detected chapters by title (regex, case-insensitive)"),
  Options.optional
)

const allOption = Options.boolean("all", {
  aliases: ["a"],
  ifPresent: true
}).pipe(
  Options.withDescription("Extract all matched chapters without interactive selection"),
  Options.withDefault(false)
)

const chaptersOnlyOption = Options.boolean("chapters-only", {
  aliases: ["c"],
  ifPresent: true
}).pipe(
  Options.withDescription("Only include numbered chapters, skip front/back matter"),
  Options.withDefault(false)
)

const FRONT_BACK_MATTER = /^(half[\s-]title|title\s+page|dedication|epigraph|contents|table\s+of\s+contents|foreword|preface|introduction|notes|bibliography|select\s+bibliography|references|acknowledge?ments|index|plates|image\s+credits|copyright|about\s+the\s+author|glossary|appendix|afterword|colophon|list\s+of)/i

const NUMBERED_CHAPTER = /^(\d+[\s.:)]\s*|chapter\s|part\s|section\s|book\s)/i

function isChapterContent(ch: Chapter): boolean {
  const title = ch.title.trim()
  if (FRONT_BACK_MATTER.test(title)) return false
  if (NUMBERED_CHAPTER.test(title)) return true
  return true
}

// List command - shows detected chapters without splitting
export const listCommand = Command.make(
  "list",
  { pdfFile, pattern: patternOption, chaptersOnly: chaptersOnlyOption },
  ({ pdfFile, pattern, chaptersOnly }) => Effect.gen(function* () {
    const pdfReader = yield* PdfReader
    const chapterDetector = yield* ChapterDetector

    yield* Console.log(`Loading PDF: ${pdfFile}`)
    const doc = yield* pdfReader.load(pdfFile)
    yield* Console.log(`Total pages: ${doc.pageCount}`)

    const customPattern = Option.map(pattern, (p) => new RegExp(p, "im"))
    const allChapters = yield* chapterDetector.detect(doc, customPattern)

    const chapters = chaptersOnly
      ? allChapters.filter(isChapterContent)
      : allChapters

    if (chaptersOnly) {
      yield* Console.log(`(--chapters-only: showing ${chapters.length} of ${allChapters.length} detected)`)
    }

    yield* Console.log(`\nDetected ${chapters.length} chapters:\n`)

    for (const ch of chapters) {
      const indent = "  ".repeat(ch.depth)
      const source = ch.source === "bookmark" ? "[bookmark]" : "[pattern]"
      yield* Console.log(
        `${indent}${ch.index + 1}. ${ch.title}`
      )
      yield* Console.log(
        `${indent}   pages ${ch.startPage}-${ch.endPage} ${source}`
      )
    }

    yield* Console.log(`\nUse --filter or --pattern with the split command to refine selection.`)
  })
).pipe(Command.withDescription("List detected chapters without splitting"))

const splitCommandImpl = Command.make(
  "split",
  { pdfFile, outputDir, pattern: patternOption, filter: filterOption, all: allOption, chaptersOnly: chaptersOnlyOption },
  ({ pdfFile, outputDir, pattern, filter, all, chaptersOnly }) => Effect.gen(function* () {
    const pdfReader = yield* PdfReader
    const chapterDetector = yield* ChapterDetector
    const pdfSplitter = yield* PdfSplitter

    yield* Console.log(`Loading PDF: ${pdfFile}`)
    const doc = yield* pdfReader.load(pdfFile)
    yield* Console.log(`Loaded ${doc.pageCount} pages`)

    yield* Console.log("Detecting chapters...")
    const customPattern = Option.map(pattern, (p) => new RegExp(p, "im"))
    const allChapters = yield* chapterDetector.detect(doc, customPattern)
    yield* Console.log(`Found ${allChapters.length} chapters`)

    const filterRegex = Option.map(filter, (f) => new RegExp(f, "i"))
    const afterRegexFilter = Option.isSome(filterRegex)
      ? allChapters.filter((ch) => filterRegex.value.test(ch.title))
      : allChapters

    if (Option.isSome(filterRegex)) {
      yield* Console.log(`After filter: ${afterRegexFilter.length} chapters`)
    }

    const chapters = chaptersOnly
      ? afterRegexFilter.filter(isChapterContent)
      : afterRegexFilter

    if (chaptersOnly) {
      yield* Console.log(`After --chapters-only: ${chapters.length} chapters`)
    }

    if (chapters.length === 0) {
      yield* Console.log("No chapters found.")
      return
    }

    const isTTY = yield* Effect.sync(() => Boolean(process.stdin.isTTY))
    if (!isTTY && !all) {
      yield* Console.log("Non-interactive mode detected, extracting all matched chapters.")
    }

    const selectedChapters = (all || !isTTY)
      ? chapters
      : yield* Prompt.multiSelect({
          message: "Select chapters to extract:",
          choices: chapters.map((ch) => ({
            title: `${"  ".repeat(ch.depth)}${ch.title} (pages ${ch.startPage}-${ch.endPage})`,
            value: ch
          }))
        })

    if (selectedChapters.length === 0) {
      yield* Console.log("No chapters selected.")
      return
    }

    yield* Console.log(`\nExtracting ${selectedChapters.length} chapters...`)
    const createdFiles = yield* pdfSplitter.split(doc, selectedChapters, outputDir)

    yield* Console.log(`\nSuccessfully created:`)
    for (const file of createdFiles) {
      yield* Console.log(`  - ${file}`)
    }
  })
).pipe(Command.withDescription("Split PDF into separate chapter files"))

export const splitCommand = Command.make("pdf-splitter", {}).pipe(
  Command.withSubcommands([listCommand, splitCommandImpl])
)
