import { EditorView, type ViewUpdate } from '@codemirror/view'
import type { RunResult } from '../types'
import { config } from './config'
import { evaluateGate, type GateState, type GateVerdict } from './gate'
import * as log from './log'
import { computeScore } from './score'
import { classify, resetSemantics, seed } from './semantics'
import { programmaticEdit } from './annotations'
import type { Contribution, Event, SemanticVerdict } from './types'

const TICK_MS = 250
/** Silences worth recording, so the log reads as a timeline of the session. */
const IDLE_MILESTONES_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 180_000]

export type WouldIntervene = {
  t: number
  trigger: 'score' | 'hardIdle'
  score: number
  reason: string
}

export type ObserverSnapshot = {
  t: number
  score: number
  contributions: Contribution[]
  gate: GateVerdict
  idleMs: number
  learnerChars: number
  cosmeticStreak: number
  lastSemantic: SemanticVerdict | null
  eventCount: number
  recent: Event[]
  interventions: WouldIntervene[]
  /** Filled in from Phase 3 onward. */
  hintTier: number | null
  attempts: number
}

// --------------------------------------------------------------- module state

let lastActivityAt = Date.now()
let lastEditAt: number | null = null
let starterLines = new Set<string>()
let learnerChars = 0
let cosmeticStreak = 0
let lastSemantic: SemanticVerdict | null = null
let revertedAt: number | null = null
let hintTier: number | null = null
let attempts = 0

const docHistory: { t: number; hash: number }[] = []
const interventions: WouldIntervene[] = []
const gateState: GateState = { lastInterventionAt: null, used: 0 }

let batch: { lines: Set<number>; charDelta: number; startedAt: number } | null = null
let batchTimer: number | null = null
let milestoneIndex = 0
let ticker: number | null = null
let currentDoc: string | null = null
/** Monotonic. Every request to the teacher is tagged with this so a late
 *  answer can be checked against the buffer it was generated from. */
let docVersion = 0

let onIntervene: ((v: WouldIntervene) => void) | null = null

// ------------------------------------------------------------------ snapshot

let current: ObserverSnapshot = emptySnapshot()
const subscribers = new Set<() => void>()

function emptySnapshot(): ObserverSnapshot {
  return {
    t: Date.now(),
    score: 0,
    contributions: [],
    gate: evaluateGate(Date.now(), 0, 0, gateState, config),
    idleMs: 0,
    learnerChars: 0,
    cosmeticStreak: 0,
    lastSemantic: null,
    eventCount: 0,
    recent: [],
    interventions: [],
    hintTier: null,
    attempts: 0,
  }
}

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

export function getSnapshot(): ObserverSnapshot {
  return current
}

// -------------------------------------------------------------------- helpers

function hash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return h
}

/** Characters on lines the learner wrote — starter lines do not count. */
function countLearnerChars(doc: string): number {
  let n = 0
  for (const raw of doc.split('\n')) {
    const line = raw.trim()
    if (!line || starterLines.has(line)) continue
    n += line.length
  }
  return n
}

function markActivity(t: number) {
  lastActivityAt = t
  milestoneIndex = 0
}

// ---------------------------------------------------------------- edit stream

/**
 * Raw CodeMirror transactions are per-keystroke; the observer works in edit
 * *batches* closed by a typing pause. "Same line edited 4 times" has to mean
 * four separate visits to that line, not four characters typed on it.
 */
export function editorExtension() {
  return EditorView.updateListener.of((u: ViewUpdate) => {
    if (!u.docChanged) return
    // App-driven doc swaps are not learner behaviour.
    if (u.transactions.some((tr) => tr.annotation(programmaticEdit))) {
      currentDoc = u.state.doc.toString()
      docVersion++
      return
    }
    const now = Date.now()
    docVersion++
    markActivity(now)
    lastEditAt = now

    if (!batch) batch = { lines: new Set(), charDelta: 0, startedAt: now }
    u.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      batch!.charDelta += inserted.length - (toA - fromA)
      const doc = u.state.doc
      const from = doc.lineAt(Math.min(fromB, doc.length)).number
      const to = doc.lineAt(Math.min(toB, doc.length)).number
      for (let l = from; l <= to; l++) batch!.lines.add(l)
    })

    const doc = u.state.doc.toString()
    currentDoc = doc
    if (batchTimer != null) window.clearTimeout(batchTimer)
    batchTimer = window.setTimeout(() => flushBatch(doc), config.editBatchMs)
  })
}

function flushBatch(doc: string) {
  if (batchTimer != null) window.clearTimeout(batchTimer)
  batchTimer = null
  const b = batch
  batch = null
  if (!b) return

  const now = Date.now()
  const event = log.append({
    t: now,
    type: 'edit',
    linesChanged: [...b.lines].sort((x, y) => x - y),
    charDelta: b.charDelta,
    semantic: 'pending',
  }) as Extract<Event, { type: 'edit' }>

  learnerChars = countLearnerChars(doc)

  // Made-and-undone: the buffer is back in a state it has already been in.
  const h = hash(doc)
  const cutoff = now - config.thrashWindowMs
  if (docHistory.some((d) => d.t >= cutoff && d.hash === h)) revertedAt = now
  docHistory.push({ t: now, hash: h })
  while (docHistory.length && docHistory[0].t < now - config.thrashWindowMs * 2) docHistory.shift()

  // Phase 2b: is this edit actually a change to the program?
  void classify(doc).then((verdict) => {
    event.semantic = verdict
    lastSemantic = verdict
    if (verdict === 'changed') cosmeticStreak = 0
    else if (verdict === 'cosmetic') cosmeticStreak += 1
    else if (verdict === 'rename') cosmeticStreak += config.renameCounts
    // 'unparseable' leaves the streak alone: beginners' code fails to parse most
    // of the time, so it is weak evidence either way.
  })
}

// ------------------------------------------------------------- other signals

export function recordRun(result: RunResult, correct: boolean) {
  const now = Date.now()
  flushBatch(currentDoc ?? '')
  markActivity(now)
  log.append({ t: now, type: 'run', result, correct })
  if (!correct) attempts++
}

/** A learner-initiated question. Resets the cooldown, costs no budget. */
export function recordAsk(text: string) {
  const now = Date.now()
  markActivity(now)
  log.append({ t: now, type: 'ask', text })
  gateState.lastInterventionAt = null
}

export function setStarter(doc: string) {
  starterLines = new Set(
    doc
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean),
  )
  currentDoc = doc
  learnerChars = 0
  cosmeticStreak = 0
  revertedAt = null
  docHistory.length = 0
  resetSemantics()
  void seed(doc)
}

export function noteDoc(doc: string) {
  currentDoc = doc
}

/** Phase 3+ fills these so the panel can show tier and attempt count. */
export function setTeachingState(tier: number | null, attemptCount: number) {
  hintTier = tier
  attempts = attemptCount
}

export function setInterveneHandler(fn: ((v: WouldIntervene) => void) | null) {
  onIntervene = fn
}

/** The worker was restarted — any in-flight AST snapshot is now meaningless. */
export function handleWorkerRestart() {
  resetSemantics()
  if (currentDoc) void seed(currentDoc)
}

export function resetSession() {
  log.clear()
  lastActivityAt = Date.now()
  lastEditAt = null
  learnerChars = 0
  cosmeticStreak = 0
  lastSemantic = null
  revertedAt = null
  attempts = 0
  docHistory.length = 0
  interventions.length = 0
  gateState.lastInterventionAt = null
  gateState.used = 0
  milestoneIndex = 0
}

export function gateSnapshot(): GateState {
  return gateState
}

export const version = () => docVersion
export const doc = () => currentDoc ?? ''
export const idleMs = () => Date.now() - lastActivityAt
export const lastEditMsAgo = () => (lastEditAt == null ? null : Date.now() - lastEditAt)
export const currentScore = () => current.score

/** A learner question resets the cooldown and costs no budget; this is how the
 *  teacher reports that it has now spoken in reply. */
export function noteTeacherSpoke(consumesBudget: boolean) {
  gateState.lastInterventionAt = Date.now()
  if (consumesBudget) gateState.used++
}

// ----------------------------------------------------------------------- tick

function tick() {
  const now = Date.now()
  const idleMs = now - lastActivityAt

  // Record silences as they cross milestones, rather than every tick.
  while (
    milestoneIndex < IDLE_MILESTONES_MS.length &&
    idleMs >= IDLE_MILESTONES_MS[milestoneIndex]
  ) {
    log.append({ t: now, type: 'idle', durationMs: IDLE_MILESTONES_MS[milestoneIndex] })
    milestoneIndex++
  }

  const events = log.all()
  const { score, contributions } = computeScore({
    now,
    config,
    events,
    lastActivityAt,
    lastEditAt,
    learnerChars,
    cosmeticStreak,
    revertedAt,
  })

  const gate = evaluateGate(now, score, idleMs, gateState, config)

  if (gate.allowed && gate.trigger) {
    const v: WouldIntervene = { t: now, trigger: gate.trigger, score, reason: gate.reason }
    interventions.push(v)
    log.append({ t: now, type: 'gate', trigger: gate.trigger, score, reason: gate.reason })
    // Start the cooldown now so the gate cannot re-fire while the request is
    // in flight, but do not spend budget yet: if the teacher decides to stay
    // silent, nothing was interrupted and nothing should be charged for.
    gateState.lastInterventionAt = now
    onIntervene?.(v)
  }

  current = {
    t: now,
    score,
    contributions,
    gate,
    idleMs,
    learnerChars,
    cosmeticStreak,
    lastSemantic,
    eventCount: log.count(),
    recent: log.recent(20),
    interventions: interventions.slice(-10),
    hintTier,
    attempts,
  }
  for (const s of subscribers) s()
}

export function start() {
  if (ticker != null) return
  ticker = window.setInterval(tick, TICK_MS)
}

export function stop() {
  if (ticker != null) window.clearInterval(ticker)
  ticker = null
}

export { log }
