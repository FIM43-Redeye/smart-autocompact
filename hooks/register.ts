import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SelfCompactPending } from '../types'

const TOOL_NAME = 'compact_context'
const TOOL = `mcp__smart-autocompact__${TOOL_NAME}`
const COMMAND = 'compact-status'

// Context marks: the first notice at FIRST_MARK and one more per STEP. From
// one STEP short of the auto-compaction point on, the notice says to start
// recording now, so the state is written down before auto-compaction forces a
// summary that cannot use tools. The point follows the session's
// autoCompactWindow; FALLBACK_PREPARE_MARK stands in when it cannot be read.
const FIRST_MARK = 300_000
const STEP = 100_000
const FALLBACK_PREPARE_MARK = 500_000

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
1. Write the state down where it belongs (never /tmp): plan and status docs, memory, findings, notes; commit finished work. What a fresh context needs: the task and where it stands, decisions and why, work in flight, standing constraints, open questions for the user, the next step.
2. Use a dedicated handoff file only when the state has no natural home or is scattered across many places; otherwise the updated documents are the record.
3. Call ${TOOL} with those files' paths, the one to start reading from first, as your last action.`

const TOOL_DESCRIPTION = `Compact this conversation's context once you have recorded its state.

${PROCEDURE}

The tool refuses records that do not exist or are empty, and wants at least one changed in the last 30 minutes. Calling it ends your turn, then compacts, so make it your last action; the summary is told to name the records.

Main conversation only. A subagent never calls this: its context compacts itself when it fills, and ending its turn would hand its report back unfinished.

- records: absolute paths of the files holding the state, the starting point first.
- instructions (optional): anything else the summary itself must keep.
- resume (optional): a note added to the resume prompt, such as the next step. A resume prompt follows every compaction, as after auto-compaction: it tells you to read the first record and carry on where you left off, or, if the work was waiting on the user, to ask again and end the turn.

When: you get a notice as the context passes 300k tokens and every 100k after. If the user is driving, ask them first. If you are working autonomously, do it at the next natural break. From 100k short of the auto-compaction point on (the notice names it), start preparing now: auto-compaction forces a tool-less summary.`

function k(tokens: number): string {
  return `${Math.round(tokens / 1000)}k`
}

function prepareMarkFor(autoCompactAt?: number): number {
  return autoCompactAt === undefined ? FALLBACK_PREPARE_MARK : autoCompactAt - STEP
}

export function markFor(tokens: number): number {
  return tokens < FIRST_MARK ? 0 : Math.floor(tokens / STEP) * STEP
}

export function noticeFor(tokens: number, autoCompactAt?: number): string {
  const head = `[smart-autocompact] Context is at ${k(tokens)} tokens.`
  const forced = autoCompactAt === undefined ? '' : ` Auto-compaction forces a summary at ${k(autoCompactAt)}, and it cannot record anything.`
  const when =
    tokens >= prepareMarkFor(autoCompactAt)
      ? `Start preparing to compact now: finish this step, record the state, and compact.${forced}`
      : 'At the next natural break (ask the user first if they are driving):'
  return `${head} ${when}\n${PROCEDURE}`
}

function summaryInstructions(request: SelfCompactPending, extra?: string): string {
  return [
    extra,
    `This session's state is recorded in: ${request.records.join(', ')}. Name these paths in the summary, the first as where to resume from.`,
    request.instructions,
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

// The summary breakdown is estimated locally: no API request.
async function autoCompactThreshold($: EngineInterface): Promise<number | undefined> {
  return (await $.session.usage({ breakdown: 'summary' })).context.breakdown?.autoCompactThreshold
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

async function queue($: EngineInterface, label: string, call: () => Promise<unknown>): Promise<void> {
  try {
    await call()
    await trace($, `${label} ran`)
  } catch (err) {
    await trace($, `${label} refused: ${String(err)}`)
    $.ui.toast(`smart-autocompact: ${label} was refused (${String(err)})`)
  }
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
    const mark = markFor(tokens)
    if (mark === 0 || mark <= (await read($, lastMark))) return ran
    await update($, lastMark, () => mark)
    const autoCompactAt = await autoCompactThreshold($)
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
    void queue($, '/compact', () => $.command.run({ command: 'compact', args: focus }))
    const prompt = resumePrompt(request)
    void queue($, 'resume prompt', () => $.prompt.submit({ text: prompt }))
    await trace($, `turn ${e.turnId} ended: queued /compact and the resume prompt`)
    return ended
  })

  // Any other compaction (the user's /compact, the auto threshold) still names
  // the pending records, and resets the marks.
  // A subagent's compaction is the engine's own and passes through untouched.
  on('session.compact', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    const request = e.trigger === 'plugin' ? null : await read($, pending)
    const instructions =
      request && !(e.instructions ?? '').includes(request.records[0] ?? '')
        ? summaryInstructions(request, e.instructions)
        : e.instructions
    const done = await next({ ...e, instructions })
    if (!('skip' in done && done.skip !== undefined)) {
      await update($, lastMark, () => 0)
      await update($, pending, () => null)
      await trace($, `compacted (${e.trigger})`)
    }
    return done
  })

  on('command.run', { command: COMMAND }, async $ => {
    const tokens = await contextTokens($)
    const autoCompactAt = await autoCompactThreshold($)
    const mark = await read($, lastMark)
    const request = await read($, pending)
    const lines = [
      `Context: ${tokens === undefined ? 'unknown' : `${k(tokens)} tokens`}.`,
      `Auto-compaction: ${autoCompactAt === undefined ? 'off' : `at ${k(autoCompactAt)}`}.`,
      `Last notice: ${mark === 0 ? 'none since the last compaction' : `the ${k(mark)} mark`}.`,
      request
        ? `Pending compaction, records: ${request.records.join(', ')}.`
        : 'No compaction pending.',
    ]
    return { text: lines.join('\n') }
  })
}
