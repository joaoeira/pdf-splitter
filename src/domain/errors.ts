import { Data } from "effect"

export class PdfNotFoundError extends Data.TaggedError("PdfNotFoundError")<{
  readonly path: string
}> {}

export class PdfReadError extends Data.TaggedError("PdfReadError")<{
  readonly path: string
  readonly reason: string
}> {}

export class NoChaptersFoundError extends Data.TaggedError("NoChaptersFoundError")<{
  readonly path: string
  readonly patternsUsed: ReadonlyArray<string>
}> {}

export class InvalidChapterRangeError extends Data.TaggedError("InvalidChapterRangeError")<{
  readonly chapter: string
  readonly startPage: number
  readonly endPage: number
}> {}

export class OutputDirectoryError extends Data.TaggedError("OutputDirectoryError")<{
  readonly path: string
  readonly reason: string
}> {}

export class PdfWriteError extends Data.TaggedError("PdfWriteError")<{
  readonly chapter: string
  readonly reason: string
}> {}
