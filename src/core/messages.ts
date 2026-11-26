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
  'plan.notice.headroom',
  'plan.notice.inconsistent',
  'plan.notice.extrapolated',
  'plan.notice.referenceZone',
  'plan.notice.referenceZonePeel',
  'plan.notice.referenceCell',
  'plan.notice.noReferenceZone',
  // strips
  'strips.warn.partial',
  // lattice
  'lattice.warn.notClosed',
  'lattice.warn.disconnected',
  'lattice.warn.compositeNoGridLine',
  'lattice.warn.compositePlainSeam',
  'lattice.warn.compositeEmptyPart',
  'lattice.warn.partNotClosed',
  'lattice.warn.partDisconnected',
  'lattice.warn.crossNoCells',
  'lattice.warn.crossNoRoom',
  'lattice.warn.crossNotClosed',
  'lattice.warn.crossDisconnected',
  // probe recommendation
  'probe.notice.overMeasuring',
  'probe.notice.coarserThanTape',
  'probe.warn.tooMany',
  // forward model
  'forward.warn.notAchievable',
  'forward.notice.bridging',
  'forward.notice.undershoot',
  // calibration fit
  'calibrate.error.noChanges',
  'calibrate.notice.singleParameter',
  'calibrate.notice.tsKept',
  'calibrate.warn.negative',
  'calibrate.warn.inconclusive',
  'calibrate.warn.onlyTs',
  'calibrate.warn.poorFit',
  'calibrate.warn.sigmaWeak',
  'calibrate.notice.tsOnly',
] as const

export type MessageCode = (typeof MESSAGE_CODES)[number]

export type MessageParams = Record<string, string | number>

export interface CoreMessage {
  code: MessageCode
  params?: MessageParams
}
