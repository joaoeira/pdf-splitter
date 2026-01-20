import { Command } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Effect, Layer, Console } from "effect"
import { splitCommand } from "./cli/command.js"
import { PdfReaderLive } from "./services/PdfReader.js"
import { ChapterDetectorLive } from "./services/ChapterDetector.js"
import { PdfSplitterLive } from "./services/PdfSplitter.js"

const MainLayer = Layer.mergeAll(
  PdfReaderLive,
  ChapterDetectorLive,
  PdfSplitterLive
)

const cli = Command.run(splitCommand, {
  name: "PDF Chapter Splitter",
  version: "1.0.0"
})

const program = Effect.suspend(() => cli(process.argv)).pipe(
  Effect.catchTags({
    PdfNotFoundError: (e) =>
      Console.error(`Error: PDF file not found at '${e.path}'`),

    PdfReadError: (e) =>
      Console.error(`Error: Could not read PDF '${e.path}': ${e.reason}`),

    NoChaptersFoundError: (e) =>
      Console.error(
        `Error: No chapters found in '${e.path}'.\n` +
        `Tried patterns: ${e.patternsUsed.join(", ")}\n` +
        `Try providing a custom pattern with --pattern`
      ),

    InvalidChapterRangeError: (e) =>
      Console.error(
        `Error: Invalid page range for '${e.chapter}': ` +
        `pages ${e.startPage}-${e.endPage}`
      ),

    OutputDirectoryError: (e) =>
      Console.error(`Error: Could not create output directory '${e.path}': ${e.reason}`),

    PdfWriteError: (e) =>
      Console.error(`Error: Failed to write chapter '${e.chapter}': ${e.reason}`)
  }),
  Effect.provide(MainLayer),
  Effect.provide(NodeContext.layer)
)

NodeRuntime.runMain(program)
