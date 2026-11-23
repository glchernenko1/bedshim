// Every user-visible message produced by `src/core` is a code plus parameters.
// The UI translates it through the i18n dictionary (`src/i18n`); the CLI prints
// the code with its parameters. Core never holds English prose (SPEC §12).
export const MESSAGE_CODES = [
  // mesh parsing
  'parse.error.empty',
  'parse.error.noPoints',
  'parse.error.badNumber',
  'parse.error.rowCount',
  'parse.error.colCount',
  'parse.error.ragged',
  'parse.error.ambiguousGrid',
  'parse.error.badBounds',
  'parse.error.profileNotFound',
  'parse.notice.inferredCounts',
  'parse.notice.inferredAlgo',
  'parse.notice.inferredTension',
  'parse.notice.inferredPps',
  'parse.notice.missingBounds',
  'parse.notice.ignoredKeys',
  'parse.notice.profiles',
  'parse.notice.unknownAlgo',
  // surface
  'surface.error.noBounds',
  'surface.notice.algoApproximated',
  'surface.notice.bilinearFallback',
  // grid
  'grid.warn.fineCells',
  'grid.warn.coarseCells',
  'grid.warn.partialCells',
  // plan
  'plan.notice.unprobed',
  'plan.notice.clamped',
  'plan.notice.inconsistent',
  // probe recommendation
  'probe.notice.overMeasuring',
  'probe.notice.coarserThanTape',
  'probe.warn.tooMany',
] as const

export type MessageCode = (typeof MESSAGE_CODES)[number]

export type MessageParams = Record<string, string | number>

export interface CoreMessage {
  code: MessageCode
  params?: MessageParams
}
