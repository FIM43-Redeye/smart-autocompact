import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const TOOL = 'mcp__smart-autocompact__compact_context'
const TRANSCRIPT = [{ role: 'user' as const, text: 'hello', toolUses: [] }]
const PLAN = '/home/u/project/plan.md'
const MEMORY = '/home/u/.claude/memory/project.md'
const MINUTE = 60_000

type Engine$ = Parameters<Parameters<typeof test>[1]>[0]

// The engine beneath the plugin: the usage it reports, the files on disk, and
// the compactions and prompts it is asked for.
function engine(on: On, tokens: { now: number }, clock: { now: () => number }, autoCompactAt = 600_000) {
  const compactions: { instructions?: string }[] = []
  const prompts: string[] = []
  const files = new Map<string, { size: number; mtimeMs: number }>()
  const aborted: string[] = []
  let isTurnRunning = false
  let isAbortHonored = true
  let traceText = ''
  let isCommandRefused = false
  let promptDrop: string | undefined
  let skip: string | undefined
  let breakdowns = 0
  let toolDescription = ''
  on('fs.write', (_, e) => {
    if (e.path.endsWith('trace.log')) traceText = e.text
    return { value: undefined }
  })

  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.register', (_, e) => {
    toolDescription = (e as unknown as { description: string }).description
    return { value: undefined } as never
  })
  on('command.register', () => ({ value: { command: 'compact-status' } }))
  on('session.usage', (_, e) => {
    if (e.breakdown) breakdowns += 1
    return usage(e.breakdown !== undefined)
  })
  const usage = (hasBreakdown: boolean) => ({
    value: {
      startedAt: 0,
      context: {
        tokens: tokens.now,
        window: 1_000_000,
        ...(hasBreakdown ? { breakdown: { autoCompactThreshold: autoCompactAt } as never } : {}),
      },
      rateLimits: [],
    },
  })
  on('fs.stat', (_, e) => {
    const file = files.get(e.path)
    if (file === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: 'file' as const, isLink: false, ...file } }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.compact', (_, e) => {
    if (isTurnRunning) throw new Error('a turn is running')
    compactions.push({ instructions: e.instructions })
    if (skip !== undefined) return { skip }
    if (e.trigger === 'precompute') return { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }
    tokens.now = 40_000
    return { messages: [{ role: 'user' as const, text: 'summary', toolUses: [] }] }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.abort', (_, e) => {
    aborted.push(e.turnId)
    if (isAbortHonored) isTurnRunning = false
    return { value: undefined }
  })
  on('command.run', (_, e, next) => {
    // The test host has no way to reject with a reason: passing the call on
    // with nothing beneath rejects it, as a refused command does.
    if (isCommandRefused) return next(e)
    prompts.push(`/${e.command} ${e.args}`)
    return { text: '' }
  })
  on('prompt.submit', (_, e) => {
    if (promptDrop !== undefined) return { drop: promptDrop }
    prompts.push(e.text)
    return { text: e.text }
  })

  return {
    compactions,
    prompts,
    aborted,
    writeFile: (path: string, size = 2_000) => files.set(path, { size, mtimeMs: clock.now() }),
    removeFile: (path: string) => files.delete(path),
    // Queued commands are refused; queued prompts are dropped too when the
    // refusal is a stop, as after the user's Esc. Until allowed again.
    refuse: (isStop: boolean) => {
      isCommandRefused = true
      promptDrop = isStop ? 'the prompt was removed from the queue before it ran' : undefined
    },
    allow: () => {
      isCommandRefused = false
      promptDrop = undefined
    },
    skipCompactions: (reason: string) => {
      skip = reason
    },
    breakdowns: () => breakdowns,
    toolDescription: () => toolDescription,
    stopTurn: () => {
      isTurnRunning = false
    },
    trace: () => traceText,
    runTurn: (isHonoringAbort = true) => {
      isTurnRunning = true
      isAbortHonored = isHonoringAbort
    },
  }
}

async function start($: Engine$) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

async function endTurn($: Engine$, turnId: string, isAborted = false) {
  await $.turn.complete({
    answer: '',
    durationMs: 1,
    isAborted,
    turnId,
    reason: isAborted ? 'aborted' : 'answer',
  })
}

async function bash($: Engine$) {
  return $.tool.call({ tool: 'Bash', command: 'ls' })
}

async function status($: Engine$): Promise<string> {
  return (await $.command.run({ command: 'compact-status', args: '' } as never)).text ?? ''
}

test('no notice below 300k tokens', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { now: 290_000 }, clock)
  await start($)

  expect((await bash($)).context ?? []).toEqual([])
})

test('one notice per 100k mark from 300k on, naming the record-first procedure', async ($, on) => {
  const clock = mock.clock(on)
  const tokens = { now: 310_000 }
  engine(on, tokens, clock)
  await start($)

  const first = (await bash($)).context?.join('\n') ?? ''
  expect(first).toMatch(/310k tokens/)
  expect(first).toMatch(/record/i)
  expect(first).not.toMatch(/preparing/i)

  tokens.now = 360_000
  expect((await bash($)).context ?? []).toEqual([])

  tokens.now = 405_000
  expect((await bash($)).context?.join('\n')).toMatch(/405k tokens/)
})

test('from 500k the notice says to start preparing, naming the auto-compaction point', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { now: 520_000 }, clock)
  await start($)

  const notice = (await bash($)).context?.join('\n') ?? ''
  expect(notice).toMatch(/start preparing to compact now/i)
  expect(notice).toMatch(/600k/)
})

test('/compact-status names the auto-compaction point', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { now: 120_000 }, clock)
  await start($)

  const status = await $.command.run({ command: 'compact-status', args: '' })
  expect(status.text).toMatch(/Auto-compaction: at 600k/)
})

test('the tool refuses until the state is recorded in real, fresh files', async ($, on) => {
  const clock = mock.clock(on, { now: 100 * MINUTE })
  const world = engine(on, { now: 300_000 }, clock)
  await start($)

  expect((await $.tool.call({ tool: TOOL })).deny).toMatch(/records/)
  expect((await $.tool.call({ tool: TOOL, records: [] })).deny).toMatch(/records/)
  expect((await $.tool.call({ tool: TOOL, records: [PLAN] })).deny).toMatch(/does not exist/)

  world.writeFile(PLAN, 0)
  expect((await $.tool.call({ tool: TOOL, records: [PLAN] })).deny).toMatch(/empty/)

  // An older doc may be pointed at, but something must have been written now.
  world.writeFile(PLAN)
  await clock.advance(31 * MINUTE)
  expect((await $.tool.call({ tool: TOOL, records: [PLAN] })).deny).toMatch(/30 minutes/)
  world.writeFile(MEMORY)
  expect((await $.tool.call({ tool: TOOL, records: [PLAN, MEMORY] })).deny).toBeUndefined()
})

test('the tool queues /compact naming the records, then the resume prompt', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)
  world.writeFile(MEMORY)

  const asked = await $.tool.call({
    tool: TOOL,
    records: [PLAN, MEMORY],
    instructions: 'Keep the open PR numbers.\nAnd the worktrees.',
    resume: 'Continue with phase 2.',
  })
  expect(asked.result).toMatch(/End the turn now/)
  expect(world.prompts).toEqual([])
  await endTurn($, 't1')
  await clock.settle()
  expect(world.compactions).toEqual([])
  expect(world.prompts.length).toBe(2)

  const compact = world.prompts[0] ?? ''
  expect(compact.startsWith('/compact ')).toBe(true)
  expect(compact).not.toContain('\n')
  expect(compact).toContain(PLAN)
  expect(compact).toContain(MEMORY)
  expect(compact).toContain('Keep the open PR numbers. And the worktrees.')

  expect(world.prompts[1]).toContain(`Read ${PLAN}`)
  expect(world.prompts[1]).toContain('Continue with phase 2.')
})

test('without a resume note, the default resume prompt still follows /compact', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  const asked = await $.tool.call({ tool: TOOL, records: [PLAN] })
  expect(asked.result).toMatch(/then the resume prompt/)
  await endTurn($, 't1')
  await clock.settle()
  expect(world.prompts.length).toBe(2)
  expect(world.prompts[0]).toMatch(/^\/compact /)
  expect(world.prompts[1]).toContain(`Read ${PLAN}`)
  expect(world.prompts[1]).toMatch(/where you left off/)
  expect(world.prompts[1]).toMatch(/waiting on the user/)
})

test('the queued /compact does not get the records twice, and clears the request', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  await endTurn($, 't1')
  await clock.settle()
  const focus = (world.prompts[0] ?? '').slice('/compact '.length)
  await $.session.compact({ instructions: focus, messages: TRANSCRIPT } as never)
  expect(world.compactions[0]?.instructions).toBe(focus)

  // Nothing pending any more: a later /compact keeps what was typed and names
  // the records once, as the earlier state.
  await $.session.compact({ instructions: 'Plain.', messages: TRANSCRIPT } as never)
  const later = world.compactions[1]?.instructions ?? ''
  expect(later.startsWith('Plain.')).toBe(true)
  expect(later).toMatch(/earlier compaction/)
  expect(later.split(PLAN).length).toBe(2)
})

test('a turn the user interrupts queues nothing', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN], resume: 'Go on.' })
  await endTurn($, 't1', true)
  await clock.settle()
  expect(world.prompts).toEqual([])
})

test('a /compact the user types while a request is pending still names the records', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  await $.session.compact({ instructions: 'Also the PR state.', messages: TRANSCRIPT } as never)
  expect(world.compactions[0]?.instructions).toMatch(/Also the PR state\./)
  expect(world.compactions[0]?.instructions).toContain(PLAN)
})

test('no notices while a compaction is pending', async ($, on) => {
  const clock = mock.clock(on)
  const tokens = { now: 350_000 }
  const world = engine(on, tokens, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  tokens.now = 410_000
  expect((await bash($)).context ?? []).toEqual([])
})

test('marks start over after a compaction', async ($, on) => {
  const clock = mock.clock(on)
  const tokens = { now: 320_000 }
  engine(on, tokens, clock)
  await start($)

  expect((await bash($)).context?.length).toBe(1)
  await $.session.compact({ messages: TRANSCRIPT } as never)
  tokens.now = 310_000
  expect((await bash($)).context?.join('\n')).toMatch(/310k tokens/)
})

// Subagents: the mod is for the main conversation alone. A subagent cannot
// start its own compaction (the engine compacts it when its context fills),
// and a notice or a tool result about compacting has made subagents hand
// their report back unfinished. So a subagent hears nothing, and a call from
// one is refused with an order to keep working.
const AGENT = 'a0fc354d7cd6e85b2'
const HANDOFF = '/home/u/project/notes/HANDOFF.md'

function agentBash($: Engine$, agentId: string) {
  return $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)
}

// A subagent's context size, as its model request reported it.
async function agentStep($: Engine$, agentId: string, contextTokens: number) {
  const stream = $.turn.step({ turnId: `turn-${agentId}`, index: 0, model: 'sonnet', messageCount: 10, agentId, usage: contextTokens } as never) as unknown as AsyncIterator<unknown>
  while (!(await stream.next()).done) {
    // drain the stream to its result
  }
}

function stepEngine(on: On) {
  on('turn.step', async function* (_, e) {
    const tokens = (e as unknown as { usage: number }).usage
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'tool_use',
      usage: {
        model: 'claude-sonnet',
        input_tokens: 1_000,
        cache_read_input_tokens: tokens - 3_000,
        cache_creation_input_tokens: 2_000,
        output_tokens: 500,
      },
    } as never
  })
}

test('a subagent calling the tool is refused and told to keep working; nothing is queued', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(HANDOFF)

  const asked = await $.tool.call({ tool: TOOL, records: [HANDOFF], resume: 'Go on.', agentId: AGENT } as never)
  expect(asked.deny).toMatch(/not for subagents/i)
  expect(asked.deny).toMatch(/keep working/i)
  expect(asked.deny).not.toMatch(/record/i)

  await endTurn($, 'main-turn')
  await clock.settle()
  expect(world.prompts).toEqual([])
  await $.session.compact({ instructions: 'Plain.', messages: TRANSCRIPT } as never)
  expect(world.compactions[0]?.instructions).toBe('Plain.')
})

test('a subagent hears no notice at any size, and its tool calls leave the main mark alone', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { now: 310_000 }, clock, 967_000)
  stepEngine(on)
  await start($)

  for (const size of [310_000, 520_000, 880_000]) {
    await agentStep($, AGENT, size)
    expect((await agentBash($, AGENT)).context ?? []).toEqual([])
  }
  expect((await bash($)).context?.join('\n')).toMatch(/310k tokens/)
})

test('a subagent compaction passes through untouched and keeps a pending main request', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  await $.session.compact({ trigger: 'auto', agentId: AGENT, instructions: 'Agent.', messages: TRANSCRIPT } as never)
  expect(world.compactions[0]?.instructions).toBe('Agent.')
  await endTurn($, 't1')
  await clock.settle()
  expect(world.prompts[0] ?? '').toContain(PLAN)
})

test('with a 1M window, "start preparing" waits until 100k before the auto-compaction point', async ($, on) => {
  const clock = mock.clock(on)
  const tokens = { now: 520_000 }
  engine(on, tokens, clock, 967_000)
  await start($)

  const early = (await bash($)).context?.join('\n') ?? ''
  expect(early).toMatch(/520k tokens/)
  expect(early).not.toMatch(/preparing/i)

  tokens.now = 870_000
  const late = (await bash($)).context?.join('\n') ?? ''
  expect(late).toMatch(/start preparing to compact now/i)
  expect(late).toMatch(/967k/)
})


// What the user said is kept at the strength they meant it, as Claude judges
// it, so a passing thought does not come back as a rule.
test('the notice asks for what the user said at the strength they meant it', async ($, on) => {
  const clock = mock.clock(on)
  engine(on, { now: 310_000 }, clock)
  await start($)

  const notice = (await bash($)).context?.join('\n') ?? ''
  expect(notice).toMatch(/at the strength they meant it/i)
  expect(notice).toMatch(/their words quoted/i)
  expect(notice).toMatch(/how firm you take each to be/i)
  expect(notice).toMatch(/edited and never rewritten/i)
})

test('the tool description leaves the firmness to Claude, which can ask the user', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 100_000 }, clock)
  await start($)

  const description = world.toolDescription()
  expect(description).toMatch(/in their own words, each with how firmly you understand them to have meant it/)
  expect(description).toMatch(/That is your judgment/)
  expect(description).toMatch(/not from tone alone/)
  expect(description).toMatch(/Where they left something open, keep it open/)
  expect(description).toMatch(/when it ends \(this task, this session, always\)/)
  expect(description).toMatch(/You can always ask/)
  expect(description).toMatch(/carry on with your best reading/)
  expect(description).toMatch(/take out what the user lifted or what belonged to a finished task/)
  // No fixed rule about what may count as a requirement.
  expect(description).not.toMatch(/stays a remark/)
})

test('the summary is told to keep how firmly the user meant things', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  await endTurn($, 't1')
  await clock.settle()
  expect(world.prompts[0]).toMatch(/without hardening a passing thought into a rule/)
  expect(world.prompts[0]).toContain(`The list in ${PLAN} is the authority`)
})

// A compaction nobody prepared for still points at the last records.
test('an unprepared compaction names the last prepared records as the earlier state', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)
  world.writeFile(MEMORY)

  expect(await status($)).toMatch(/No prepared compaction yet/)
  await $.tool.call({ tool: TOOL, records: [PLAN, MEMORY] })
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT } as never)
  expect(await status($)).toMatch(new RegExp(`State last recorded .* in: ${PLAN}, ${MEMORY}`))

  await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT } as never)
  const auto = world.compactions[1]?.instructions ?? ''
  expect(auto).toContain(PLAN)
  expect(auto).toContain(MEMORY)
  expect(auto).toMatch(/predate the work since/)
  expect(auto).not.toMatch(/the first as where to resume from/)
})

test('earlier records that are gone from disk are not named', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)
  world.writeFile(MEMORY)

  await $.tool.call({ tool: TOOL, records: [PLAN, MEMORY] })
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT } as never)
  world.removeFile(PLAN)
  await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT } as never)
  expect(world.compactions[1]?.instructions).toContain(MEMORY)
  expect(world.compactions[1]?.instructions).not.toContain(PLAN)

  world.removeFile(MEMORY)
  await $.session.compact({ trigger: 'auto', instructions: 'Plain.', messages: TRANSCRIPT } as never)
  expect(world.compactions[2]?.instructions).toBe('Plain.')
})

test('a session with no prepared compaction leaves other compactions as they came', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)

  await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT } as never)
  expect(world.compactions[0]?.instructions).toBeUndefined()
})

// A queued /compact that never runs must not leave the request stuck.
test('a stop that drops /compact and the resume prompt leaves the request for the next turn end', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN], resume: 'Go on.' })
  world.refuse(true)
  await endTurn($, 't1')
  await clock.settle()
  expect(world.prompts).toEqual([])
  expect(world.trace()).toMatch(/request left pending for the next turn end/)
  expect(await status($)).toMatch(/Pending compaction/)

  world.allow()
  await endTurn($, 't2')
  await clock.settle()
  expect(world.prompts.length).toBe(2)
  expect(world.prompts[0]).toMatch(/^\/compact /)
  expect(world.prompts[1]).toContain('Go on.')
})

test('a refused /compact whose resume prompt went out drops the request, and the notices return', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on)
  const tokens = { now: 350_000 }
  const world = engine(on, tokens, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  world.refuse(false)
  await endTurn($, 't1')
  await clock.settle()
  expect(world.prompts.length).toBe(1)
  expect(world.trace()).toMatch(/request dropped: the resume prompt went out without a compaction/)
  expect(await status($)).toMatch(/No compaction pending/)

  // The turn the resume prompt started ends: nothing is queued again.
  world.allow()
  await endTurn($, 't2')
  await clock.settle()
  expect(world.prompts.length).toBe(1)
  tokens.now = 410_000
  expect((await bash($)).context?.join('\n')).toMatch(/410k tokens/)
})

test('a queued compaction that is skipped drops the request', async ($, on) => {
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  await endTurn($, 't1')
  await clock.settle()
  world.skipCompactions('a PreCompact hook blocked it')
  const focus = (world.prompts[0] ?? '').slice('/compact '.length)
  await $.session.compact({ trigger: 'manual', instructions: focus, messages: TRANSCRIPT } as never)
  expect(await status($)).toMatch(/No compaction pending/)
  expect(await status($)).toMatch(/No prepared compaction yet/)
  expect(world.trace()).toMatch(/compaction skipped, request dropped/)
})

test('a skipped compaction leaves a request that was not queued yet', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 400_000 }, clock)
  await start($)
  world.writeFile(PLAN)

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  world.skipCompactions('not enough to compact')
  await $.session.compact({ trigger: 'manual', messages: TRANSCRIPT } as never)
  expect(await status($)).toMatch(/Pending compaction/)
})

test('a summary computed ahead of time names the records but clears nothing', async ($, on) => {
  const clock = mock.clock(on)
  const tokens = { now: 320_000 }
  const world = engine(on, tokens, clock)
  await start($)
  world.writeFile(PLAN)

  expect((await bash($)).context?.length).toBe(1)
  await $.session.compact({ trigger: 'precompute', messages: TRANSCRIPT } as never)
  tokens.now = 330_000
  expect((await bash($)).context ?? []).toEqual([])

  await $.tool.call({ tool: TOOL, records: [PLAN] })
  await $.session.compact({ trigger: 'precompute', messages: TRANSCRIPT } as never)
  expect(world.compactions[1]?.instructions).toContain(PLAN)
  expect(await status($)).toMatch(/Pending compaction/)
  expect(await status($)).toMatch(/No prepared compaction yet/)
})

// The marks follow the auto-compaction point, so a small window gets notices.
test('with a 200k window the marks scale down: half the point, then a sixth per step', async ($, on) => {
  const clock = mock.clock(on)
  const tokens = { now: 80_000 }
  engine(on, tokens, clock, 167_000)
  await start($)

  expect((await bash($)).context ?? []).toEqual([])

  tokens.now = 85_000
  const first = (await bash($)).context?.join('\n') ?? ''
  expect(first).toMatch(/85k tokens/)
  expect(first).not.toMatch(/preparing/i)

  tokens.now = 100_000
  expect((await bash($)).context ?? []).toEqual([])

  tokens.now = 113_000
  expect((await bash($)).context?.join('\n')).toMatch(/113k tokens/)

  tokens.now = 141_000
  const last = (await bash($)).context?.join('\n') ?? ''
  expect(last).toMatch(/start preparing to compact now/i)
  expect(last).toMatch(/167k/)
})

test('the auto-compaction point is read once for many tool calls, and again after a compaction', async ($, on) => {
  const clock = mock.clock(on)
  const world = engine(on, { now: 120_000 }, clock)
  await start($)

  for (let i = 0; i < 5; i += 1) await bash($)
  expect(world.breakdowns()).toBe(1)

  await clock.advance(6 * MINUTE)
  await bash($)
  expect(world.breakdowns()).toBe(2)

  await $.session.compact({ trigger: 'auto', messages: TRANSCRIPT } as never)
  await bash($)
  expect(world.breakdowns()).toBe(3)
})
