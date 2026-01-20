import { Args, Command, Options, Prompt } from "@effect/cli"
import { Effect, Option, Console } from "effect"
import { PdfReader } from "../services/PdfReader.js"
import { ChapterDetector } from "../services/ChapterDetector.js"
import { PdfSplitter } from "../services/PdfSplitter.js"

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

export const splitCommand = Command.make(
  "pdf-split",
  { pdfFile, outputDir, pattern: patternOption, filter: filterOption },
  ({ pdfFile, outputDir, pattern, filter }) => Effect.gen(function* () {
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
    const chapters = Option.isSome(filterRegex)
      ? allChapters.filter((ch) => filterRegex.value.test(ch.title))
      : allChapters

    if (Option.isSome(filterRegex)) {
      yield* Console.log(`After filter: ${chapters.length} chapters`)
    }

    if (chapters.length === 0) {
      yield* Console.log("No chapters found.")
      return
    }

    const selectedChapters = yield* Prompt.multiSelect({
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
)
