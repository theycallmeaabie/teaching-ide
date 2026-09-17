/**
 * Every threshold and weight the observer uses. All of it is live-tunable from
 * the dev panel — tuning this is the project, and it cannot be done blind.
 */
export type ObserverConfig = {
  // --- window & gate ---
  windowMs: number
  threshold: number
  cooldownMs: number
  budget: number
  hardIdleMs: number

  // --- batching ---
  editBatchMs: number

  // --- positive: idle after error ---
  wIdleAfterError: number
  /** Same signal, but the run was clean and the answer wrong. */
  wIdleAfterWrong: number
  idleAfterErrorStartMs: number
  idleAfterErrorFullMs: number

  // --- positive: thrash ---
  wThrashLines: number
  thrashWindowMs: number
  thrashLineVisits: number
  wUndoRevert: number
  wRepeatedError: number

  // --- positive: no semantic change ---
  wNoSemantic: number
  noSemanticBatches: number
  renameCounts: number // how much a rename-only batch counts as cosmetic (0..1)

  // --- positive: empty-buffer silence ---
  wEmptySilence: number
  emptySilenceStartMs: number
  emptySilenceFullMs: number
  emptyBufferMaxChars: number

  // --- negative: progress ---
  dSuccessfulRun: number
  dSemanticProgress: number
  dForwardTyping: number
  forwardTypingWindowMs: number
  forwardTypingChars: number
}

export const DEFAULT_CONFIG: ObserverConfig = {
  windowMs: 60_000,
  threshold: 0.6,
  cooldownMs: 45_000,
  budget: 8,
  hardIdleMs: 180_000,

  editBatchMs: 700,

  wIdleAfterError: 0.7,
  wIdleAfterWrong: 0.7,
  idleAfterErrorStartMs: 4_000,
  idleAfterErrorFullMs: 40_000,

  wThrashLines: 0.3,
  thrashWindowMs: 30_000,
  thrashLineVisits: 4,
  wUndoRevert: 0.2,
  wRepeatedError: 0.15,

  wNoSemantic: 0.3,
  noSemanticBatches: 3,
  renameCounts: 0.5,

  wEmptySilence: 0.65,
  emptySilenceStartMs: 25_000,
  emptySilenceFullMs: 75_000,
  emptyBufferMaxChars: 25,

  dSuccessfulRun: 0.8,
  dSemanticProgress: 0.25,
  dForwardTyping: 0.3,
  forwardTypingWindowMs: 15_000,
  forwardTypingChars: 20,
}

type Field = {
  key: keyof ObserverConfig
  label: string
  min: number
  max: number
  step: number
  /** 'ms' renders as seconds; 'w' is a weight; 'n' is a plain count. */
  unit: 'ms' | 'w' | 'n'
  group: string
}

export const CONFIG_FIELDS: Field[] = [
  { key: 'threshold', label: 'Intervention threshold', min: 0, max: 1, step: 0.01, unit: 'w', group: 'Gate' },
  { key: 'cooldownMs', label: 'Cooldown', min: 0, max: 180_000, step: 5_000, unit: 'ms', group: 'Gate' },
  { key: 'budget', label: 'Interruption budget', min: 0, max: 30, step: 1, unit: 'n', group: 'Gate' },
  { key: 'hardIdleMs', label: 'Hard idle ceiling', min: 30_000, max: 600_000, step: 15_000, unit: 'ms', group: 'Gate' },
  { key: 'windowMs', label: 'Scoring window', min: 15_000, max: 180_000, step: 5_000, unit: 'ms', group: 'Gate' },
  { key: 'editBatchMs', label: 'Edit batch gap', min: 200, max: 3_000, step: 100, unit: 'ms', group: 'Gate' },

  { key: 'wIdleAfterError', label: 'weight', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Idle after error' },
  { key: 'wIdleAfterWrong', label: 'weight (ran clean, wrong answer)', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Idle after error' },
  { key: 'idleAfterErrorStartMs', label: 'ramp starts', min: 0, max: 30_000, step: 1_000, unit: 'ms', group: 'Idle after error' },
  { key: 'idleAfterErrorFullMs', label: 'ramp full', min: 5_000, max: 120_000, step: 5_000, unit: 'ms', group: 'Idle after error' },

  { key: 'wThrashLines', label: 'line revisits weight', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Thrash' },
  { key: 'thrashLineVisits', label: 'revisits to trigger', min: 2, max: 10, step: 1, unit: 'n', group: 'Thrash' },
  { key: 'thrashWindowMs', label: 'thrash window', min: 5_000, max: 120_000, step: 5_000, unit: 'ms', group: 'Thrash' },
  { key: 'wUndoRevert', label: 'made-and-undone weight', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Thrash' },
  { key: 'wRepeatedError', label: 'same error again weight', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Thrash' },

  { key: 'wNoSemantic', label: 'weight', min: 0, max: 1, step: 0.05, unit: 'w', group: 'No semantic change' },
  { key: 'noSemanticBatches', label: 'batches for full weight', min: 1, max: 10, step: 1, unit: 'n', group: 'No semantic change' },
  { key: 'renameCounts', label: 'a rename counts as', min: 0, max: 1, step: 0.1, unit: 'w', group: 'No semantic change' },

  { key: 'wEmptySilence', label: 'weight', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Empty-buffer silence' },
  { key: 'emptySilenceStartMs', label: 'ramp starts', min: 0, max: 120_000, step: 5_000, unit: 'ms', group: 'Empty-buffer silence' },
  { key: 'emptySilenceFullMs', label: 'ramp full', min: 10_000, max: 240_000, step: 5_000, unit: 'ms', group: 'Empty-buffer silence' },
  { key: 'emptyBufferMaxChars', label: 'chars that still count as empty', min: 0, max: 200, step: 5, unit: 'n', group: 'Empty-buffer silence' },

  { key: 'dSuccessfulRun', label: 'successful run', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Progress (subtracts)' },
  { key: 'dSemanticProgress', label: 'new line that parses', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Progress (subtracts)' },
  { key: 'dForwardTyping', label: 'steady forward typing', min: 0, max: 1, step: 0.05, unit: 'w', group: 'Progress (subtracts)' },
  { key: 'forwardTypingWindowMs', label: 'typing window', min: 3_000, max: 60_000, step: 1_000, unit: 'ms', group: 'Progress (subtracts)' },
  { key: 'forwardTypingChars', label: 'net chars to count', min: 1, max: 200, step: 1, unit: 'n', group: 'Progress (subtracts)' },
]

export const config: ObserverConfig = { ...DEFAULT_CONFIG }

const listeners = new Set<() => void>()

export function setConfigValue(key: keyof ObserverConfig, value: number) {
  config[key] = value
  for (const l of listeners) l()
}

export function resetConfig() {
  Object.assign(config, DEFAULT_CONFIG)
  for (const l of listeners) l()
}

export function subscribeConfig(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
