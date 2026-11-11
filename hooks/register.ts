import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SelfCompactPending, SelfCompactRecorded, SelfCompactThreshold } from '../types'

const TOOL_NAME = 'compact_context'
const TOOL = `mcp__smart-autocompact__${TOOL_NAME}`
const COMMAND = 'compact-status'

// Context marks: the first notice at the first mark and one more per step.
// From one step short of the auto-compaction point on, the notice says to
// start recording now, so the state is written down before auto-compaction
// forces a summary that cannot use tools. The marks follow the session's
// auto-compaction point (half of it, then a sixth of it per step), so a small
// window gets its notices too, and are capped at FIRST_MARK and STEP so a
// large one does not get them later. When the point cannot be read, the caps
// are the marks and FALLBACK_PREPARE_MARK stands in for the last one.
const FIRST_MARK = 300_000
const STEP = 100_000
const FALLBACK_PREPARE_MARK = 500_000
const FIRST_SHARE = 1 / 2
const STEP_SHARE = 1 / 6

// The auto-compaction point is read with a usage breakdown, so it is kept for
// a while instead of read on every tool call; a compaction drops it.
const THRESHOLD_MS = 5 * 60_000

// At least one record must have been written for this compaction; the
// others may be older documents it points at.
const FRESH_MS = 30 * 60_000

// $.session.compact is refused in a headless session (the desktop app's):
// there compaction only runs as a /compact prompt. And neither compact nor
// prompt.submit may be called from a tool.call hook (they would wait on the
// running turn); the host points at turn.complete. So the tool records the
// request, and the turn.complete hook queues /compact ($.command.run: a
// prompt starting with / is refused) and then the resume prompt, each run
// once the session is idle.
const TRACE_LINES = 200

const pending = atom({ plugin: 'smart-autocompact', key: 'pending' } as const, null as SelfCompactPending | null)
const lastMark = atom({ plugin: 'smart-autocompact', key: 'lastMark' } as const, 0)
const lastRecorded = atom({ plugin: 'smart-autocompact', key: 'lastRecorded' } as const, null as SelfCompactRecorded | null)
const threshold = atom({ plugin: 'smart-autocompact', key: 'threshold' } as const, null as SelfCompactThreshold | null)

// Subagents. The mod serves the main conversation alone. A subagent cannot
// start its own compaction ($.session.compact acts on the main conversation
// only; the engine compacts a subagent when its context fills), and every
// notice or tool result about compacting that reached one made it hand its
// report back unfinished. So subagents hear nothing, and a call from one is
// refused with an order to keep working.

// A trace of what the mod did, in ~/.cache/smart-autocompact/trace.log, so a
// compaction that never happened leaves evidence. Best effort.
const traceLines: string[] = []
async function trace($: EngineInterface, line: string): Promise<void> {
  try {
    const home = await $.env.get('HOME')
    if (home === undefined) return
    traceLines.push(`${new Date(await $.clock.now()).toISOString()} ${line}`)
    traceLines.splice(0, Math.max(0, traceLines.length - TRACE_LINES))
    await $.fs.write(`${home}/.cache/smart-autocompact/trace.log`, traceLines.join('\n') + '\n')
  } catch {
    // tracing must never break the mod
  }
}

const PROCEDURE = `Record first, then compact. Compaction keeps only a model-written summary, so anything you have not written down is lost:
1. Write the state down where it belongs (never /tmp): plan and status docs, memory, findings, notes; commit finished work. What a fresh context needs: the task and where it stands, decisions and why, work in flight, open questions for the user, the next step, and what the user said about how the work should go.
2. Keep what the user said at the strength they said it: requirements and remarks apart in the record you will name first, their words quoted, the list edited and never rewritten ("What the user said" in the ${TOOL} description has the details).
3. Use a dedicated handoff file only when the state has no natural home or is scattered across many places; otherwise the updated documents are the record.
4. Call ${TOOL} with those files' paths, the one to start reading from first, as your last action.`

const TOOL_DESCRIPTION = `Compact this conversation's context once you have recorded its state.

${PROCEDURE}

The tool refuses records that do not exist or are empty, and wants at least one changed in the last 30 minutes. Calling it ends your turn, then compacts, so make it your last action; the summary is told to name the records.

Main conversation only. A subagent never calls this: its context compacts itself when it fills, and ending its turn would hand its report back unfinished.

What the user said. A summary flattens it: a requirement gets dropped, or a passing remark hardens into a rule. So the record you name first keeps a list in two parts, every entry with the user's own words quoted:
- Requirements: what the user set out as having to hold, or confirmed when you asked. Note what each applies to and when it ends (this task, this session, always).
- Remarks: leanings, half-formed thoughts, things said in passing. Keep the words and the doubt in them, and add your reading marked as your reading. A remark stays a remark until the user makes it a requirement: when the work turns on one, ask them; when they are away, put it under open questions and take the reading that is easiest to undo.
Edit the list, never rewrite it from memory: add to it, and take out what the user lifted or what belonged to a finished task, so nothing meant for one task follows the whole session. A requirement that should outlast the session also belongs in memory or CLAUDE.md.
Before the user leaves you to work on your own, if what must hold is not clear, ask them to set out their requirements. When they are driving and you ask before compacting, show them the list so they can correct it.

- records: absolute paths of the files holding the state, the starting point first.
- instructions (optional): anything else the summary itself must keep.
- resume (optional): a note added to the resume prompt, such as the next step. A resume prompt follows every compaction, as after auto-compaction: it tells you to read the first record and carry on where you left off, or, if the work was waiting on the user, to ask again and end the turn.

When: notices arrive as the context grows, the first at half the auto-compaction point (at 300k tokens at the latest), then at regular steps. If the user is driving, ask them first. If you are working autonomously, do it at the next natural break. From the last step before the auto-compaction point on (the notice names it), start preparing now: auto-compaction forces a tool-less summary.`

function k(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

function roundK(tokens: number): number {
  return Math.max(1_000, Math.round(tokens / 1_000) * 1_000)
}

// Where the notices fall for a session that auto-compacts at autoCompactAt.
export function marksFor(autoCompactAt?: number): { first: number; step: number; prepare: number } {
  if (autoCompactAt === undefined) return { first: FIRST_MARK, step: STEP, prepare: FALLBACK_PREPARE_MARK }
  const step = Math.min(STEP, roundK(autoCompactAt * STEP_SHARE))
  return { first: Math.min(FIRST_MARK, roundK(autoCompactAt * FIRST_SHARE)), step, prepare: autoCompactAt - step }
}

export function markFor(tokens: number, autoCompactAt?: number): number {
  const { first, step } = marksFor(autoCompactAt)
  return tokens < first ? 0 : first + Math.floor((tokens - first) / step) * step
}

export function noticeFor(tokens: number, autoCompactAt?: number): string {
  const head = `[smart-autocompact] Context is at ${k(tokens)} tokens.`
  const forced = autoCompactAt === undefined ? '' : ` Auto-compaction forces a summary at ${k(autoCompactAt)}, and it cannot record anything.`
  const when =
    tokens >= marksFor(autoCompactAt).prepare
      ? `Start preparing to compact now: finish this step, record the state, and compact.${forced}`
      : 'At the next natural break (ask the user first if they are driving):'
  return `${head} ${when}\n${PROCEDURE}`
}

function summaryInstructions(request: SelfCompactPending, extra?: string): string {
  return [
    extra,
    `This session's state is recorded in: ${request.records.join(', ')}. Name these paths in the summary, the first as where to resume from.`,
    `Where the summary says what the user asked for, keep their wording and how firmly they said it: a remark is not a requirement. The list in ${request.records[0]} is the authority on both.`,
    request.instructions,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// For a compaction nobody prepared for: the summary still says where the state
// was last written down, and that it is older than the work since.
function earlierInstructions(records: string[], extra?: string): string {
  return [
    extra,
    `Before an earlier compaction, this session's state was recorded in: ${records.join(', ')}. Name these paths in the summary as where that earlier state is written down, and say that they predate the work since, so for anything later the summary is the newer account.`,
  ]
    .filter(Boolean)
    .join('\n\n')
}

// Sent after every self-compaction, so the work carries on as it does after
// auto-compaction instead of stopping until the user writes.
const CONTINUE = `Continue from where you left off without asking the user any further questions. Resume directly: do not acknowledge the compaction or recap what was happening. If the work was waiting on the user (a question or an approval), ask it again in one line and end the turn.`

function resumePrompt(request: SelfCompactPending): string {
  const others = request.records.length > 1 ? `; the state is also in ${request.records.slice(1).join(', ')}` : ''
  return [`The conversation was compacted at your request. Read ${request.records[0]} before anything else${others}.`, CONTINUE, request.resume]
    .filter(Boolean)
    .join('\n\n')
}

async function contextTokens($: EngineInterface): Promise<number | undefined> {
  return (await $.session.usage()).context.tokens
}

// The summary breakdown is estimated locally: no API request. Kept for
// THRESHOLD_MS, so most tool calls cost no breakdown.
async function autoCompactThreshold($: EngineInterface): Promise<number | undefined> {
  const now = await $.clock.now()
  const kept = await read($, threshold)
  if (kept !== null && now - kept.at < THRESHOLD_MS) return kept.tokens
  const tokens = (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.autoCompactThreshold
  await update($, threshold, () => ({ ...(tokens === undefined ? {} : { tokens }), at: now }))
  return tokens
}

// The records of the last prepared compaction that are still on disk.
async function earlierRecords($: EngineInterface): Promise<string[]> {
  const recorded = await read($, lastRecorded)
  if (recorded === null) return []
  const found: string[] = []
  for (const path of recorded.records) {
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat !== undefined && stat.kind === 'file' && stat.size > 0) found.push(path)
  }
  return found
}

// Why these records can't be used yet, or undefined when they can.
async function recordsProblem($: EngineInterface, paths: string[]): Promise<string | undefined> {
  const now = await $.clock.now()
  let isAnyFresh = false
  for (const path of paths) {
    if (!path.startsWith('/')) return `records must be absolute paths, not "${path}".`
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat === undefined || stat.kind !== 'file') return `${path} does not exist: record the state first.`
    if (stat.size === 0) return `${path} is empty: record the state first.`
    if (now - stat.mtimeMs <= FRESH_MS) isAnyFresh = true
  }
  if (!isAnyFresh) {
    return 'None of these records changed in the last 30 minutes: write the current state down first.'
  }
  return undefined
}

// Runs the queued /compact and the resume prompt behind it. A /compact the
// engine refused must not leave its request marked as queued: no compaction
// will clear it, and a pending request silences the notices. What to do turns
// on the resume prompt:
// - it never entered (the user stopped the session, which drops queued work):
//   no turn follows, so the request waits for the next turn end;
// - it entered: a turn is running on it, and queueing again when that turn
//   ends could go round for ever, so the request is dropped.
// A /compact that ran is settled by the session.compact hook.
async function runQueued($: EngineInterface, focus: string, prompt: string): Promise<void> {
  const compact = $.command.run({ command: 'compact', args: focus }).then(
    () => undefined,
    (err: unknown) => String(err),
  )
  const resume = $.prompt.submit({ text: prompt }).then(
    entered => entered.drop,
    (err: unknown) => String(err),
  )
  const [refused, dropped] = await Promise.all([compact, resume])
  await trace($, refused === undefined ? '/compact ran' : `/compact refused: ${refused}`)
  await trace($, dropped === undefined ? 'resume prompt ran' : `resume prompt dropped: ${dropped}`)
  if (refused === undefined) return
  $.ui.toast(`smart-autocompact: /compact did not run (${refused})`)

  const request = await read($, pending)
  if (request === null || !request.isQueued) return
  if (dropped === undefined) {
    await update($, pending, () => null)
    await trace($, 'request dropped: the resume prompt went out without a compaction')
    return
  }
  const { isQueued: _, ...waiting } = request
  await update($, pending, () => waiting)
  await trace($, 'request left pending for the next turn end')
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          records: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            description: 'Absolute paths of the files holding the state, the starting point first.',
          },
          instructions: { type: 'string', description: 'Anything else the summary itself must keep.' },
          resume: { type: 'string', description: 'A note added to the resume prompt that follows the compaction, such as the next step.' },
        },
        required: ['records'],
      },
    })
    await $.command.register({
      name: COMMAND,
      description: 'Show the context size, the last smart-autocompact notice, and any pending compaction.',
    })
    await trace($, 'session started')
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId !== undefined) {
      return { deny: `${TOOL_NAME} is not for subagents. Ignore it and keep working on your task; your context compacts itself when it fills.` }
    }
    const input = e as unknown as Record<string, unknown>
    const records = Array.isArray(input.records)
      ? input.records.map(text).filter((r): r is string => r !== undefined)
      : []
    if (records.length === 0) {
      return { deny: `compact_context needs records: the files holding the state. ${PROCEDURE}` }
    }
    const problem = await recordsProblem($, records)
    if (problem !== undefined) return { deny: problem }
    const request: SelfCompactPending = {
      records,
      instructions: text(input.instructions),
      resume: text(input.resume),
    }
    await update($, pending, () => request)
    await trace($, `requested, records: ${records.join(', ')}`)
    return {
      result: 'Compaction queued: /compact runs as soon as this turn ends, then the resume prompt. End the turn now.',
    }
  })

  // Notices ride on tool results, so they reach the model mid-turn, once per
  // mark, off the session's usage. Never to a subagent.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.tool === TOOL || ran.deny !== undefined) return ran
    if (e.agentId !== undefined) return ran
    if ((await read($, pending)) !== null) return ran
    const tokens = await contextTokens($)
    if (tokens === undefined) return ran
    const autoCompactAt = await autoCompactThreshold($)
    const mark = markFor(tokens, autoCompactAt)
    if (mark === 0 || mark <= (await read($, lastMark))) return ran
    await update($, lastMark, () => mark)
    return { ...ran, context: [...(ran.context ?? []), noticeFor(tokens, autoCompactAt)] }
  })

  on('turn.complete', async ($, e, next) => {
    const ended = await next(e)
    if (e.agentId !== undefined) return ended
    const request = await read($, pending)
    if (request === null || request.isQueued) return ended
    if (e.isAborted) {
      await trace($, 'turn interrupted: compaction left pending')
      return ended
    }
    await update($, pending, () => ({ ...request, isQueued: true as const }))
    // One line: a command's arguments end at the first newline. Not awaited:
    // a submission resolves only when its turn starts, after this hook.
    const focus = summaryInstructions(request).replace(/\s*\n+\s*/g, ' ')
    void runQueued($, focus, resumePrompt(request))
    await trace($, `turn ${e.turnId} ended: queued /compact and the resume prompt`)
    return ended
  })

  // Any other compaction (the user's /compact, the auto threshold) still names
  // the pending records, and resets the marks. With nothing pending it names
  // the records of the last prepared compaction, as older than the work since.
  // A subagent's compaction is the engine's own and passes through untouched.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const waiting = await read($, pending)
    const request = e.trigger === 'plugin' ? null : waiting
    const given = e.instructions ?? ''
    let instructions = e.instructions
    if (request) {
      if (!given.includes(request.records[0] ?? '')) instructions = summaryInstructions(request, e.instructions)
    } else if (waiting === null) {
      const earlier = await earlierRecords($)
      if (earlier[0] !== undefined && !given.includes(earlier[0])) instructions = earlierInstructions(earlier, e.instructions)
    }
    const done = await next({ ...e, instructions })
    // Computed ahead of time, installed by a later compaction: nothing has
    // been compacted yet, so the request and the marks stand either way.
    if (e.trigger === 'precompute') return done
    if ('skip' in done && done.skip !== undefined) {
      // Skipped after /compact was queued for it: nothing else would clear the
      // request, and the resume prompt behind it has gone out already.
      if (waiting?.isQueued) {
        await update($, pending, () => null)
        await trace($, `compaction skipped, request dropped: ${done.skip}`)
        $.ui.toast(`smart-autocompact: the compaction was skipped (${done.skip})`)
      }
      return done
    }
    if (waiting !== null) {
      const at = await $.clock.now()
      await update($, lastRecorded, () => ({ records: waiting.records, at }))
    }
    await update($, lastMark, () => 0)
    await update($, pending, () => null)
    await update($, threshold, () => null)
    await trace($, `compacted (${e.trigger})`)
    return done
  })

  on('command.run', { command: COMMAND }, async $ => {
    const tokens = await contextTokens($)
    const autoCompactAt = await autoCompactThreshold($)
    const mark = await read($, lastMark)
    const request = await read($, pending)
    const recorded = await read($, lastRecorded)
    const lines = [
      `Context: ${tokens === undefined ? 'unknown' : `${k(tokens)} tokens`}.`,
      `Auto-compaction: ${autoCompactAt === undefined ? 'off' : `at ${k(autoCompactAt)}`}.`,
      `Last notice: ${mark === 0 ? 'none since the last compaction' : `the ${k(mark)} mark`}.`,
      request
        ? `Pending compaction, records: ${request.records.join(', ')}.`
        : 'No compaction pending.',
      recorded
        ? `State last recorded (${new Date(recorded.at).toISOString()}) in: ${recorded.records.join(', ')}.`
        : 'No prepared compaction yet this session.',
    ]
    return { text: lines.join('\n') }
  })
}
