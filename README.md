# smart-autocompact

A Claude Code mod that lets Claude compact its own context on purpose: it
writes down what it knows first, then compacts, then carries on.

Native auto-compaction fires when the context is nearly full. The summary it
produces is written in one pass with no tools. Anything the model had not
already put in a file (the state of a half-finished change, a decision and its
reason, the next step) survives only as well as that summary. On long
autonomous runs, that is where work gets lost.

This mod changes the order: record first, then compact.

## What it does

- **A `compact_context` tool.** Claude calls it once it has written the
  session's state where it belongs: plan and status docs, notes, memory,
  commits. It passes the paths of those files, starting point first. The tool
  refuses paths that don't exist or are empty. It also requires at least one
  of them to have changed in the last 30 minutes, so Claude can't hand over
  stale notes.
- **Standing instructions, with a scope and an end.** A summary tends to drop
  what you told Claude along the way ("don't touch the auth module", "ask
  before pushing"). The procedure has Claude keep those as a list in the first
  record: your words quoted, what each applies to, and when it ends. Claude
  edits the list instead of rewriting it, and takes out what you lifted or
  what belonged to a finished task, so an instruction meant for one task does
  not follow the whole session.
- **Compaction at the turn boundary.** When the turn ends, the mod runs
  `/compact` with summary instructions that name the record files.
- **Then it keeps going.** A resume prompt follows every compaction: read the
  first record and continue where the work left off, with no recap. If the
  work was waiting on the user (a question or an approval), Claude asks it
  again in one line and stops instead. An optional `resume` note adds a
  specific next step.
- **Context-size notices.** As the context grows, a notice rides on a tool
  result. It reminds Claude of the procedure and asks it to compact at the
  next natural break. The marks follow the session's auto-compaction point:
  the first at half of it, then one per sixth of it, capped at 300k tokens
  and 100k per step. So a 1M window gets notices at 300k, 400k and so on, and
  a 200k window gets them too, from about 84k. From the last step before the
  auto-compaction point the notice says to start preparing now, because the
  forced summary can't record anything.
- **Main conversation only.** Subagents get no notices, and the tool refuses
  them. Their context compacts itself when it fills, and a subagent that ends
  its turn hands back an unfinished report.
- **Other compactions still use the records.** If you type `/compact` (or
  auto-compaction fires) while a request is pending, the summary
  instructions still name the record files. With nothing pending, a
  compaction nobody prepared for names the records of the last prepared one,
  as the earlier state that predates the work since. Records that are gone
  from disk are left out.

`/compact-status` shows the current context size, the auto-compaction point,
the last notice, anything pending, and where the state was last recorded. A trace of what the mod did is kept at
`~/.cache/smart-autocompact/trace.log`.

## Requirements

This mod is a hooks module, built on Claude Code's plugin hooks API. That API
is marked early access and can change between releases. It was developed and
is used on Claude Code 2.1.309, mostly in the desktop app's Code tab. Older
builds may not load hooks modules at all.

## Install

At the prompt of a terminal session:

```
/plugin install smart-autocompact --marketplace FIM43-Redeye/smart-autocompact
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```bash
claude plugin install smart-autocompact --marketplace FIM43-Redeye/smart-autocompact
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, then Add marketplace with `FIM43-Redeye/smart-autocompact`,
then Add plugin.

## Using it well

The tool's description carries the procedure, so Claude knows how to use it.
It helps to say in your `CLAUDE.md` where state belongs in your project, and
whether Claude should compact without asking. For example:

```
When a smart-autocompact notice arrives, record the state and compact at the
next natural break without asking.
```

## How it works

A tool call can't compact directly: compaction and prompt submission both wait
on the running turn. Some hosts, like the desktop app's headless sessions,
also refuse direct compaction. So the tool only stores the request. A
`turn.complete` hook then queues `/compact` and the resume prompt, and each
runs once the session is idle. A `session.compact` hook clears the request and
resets the notice marks.

A queued `/compact` that never runs does not leave the request stuck. If you
stopped the session, which drops the resume prompt too, the request waits for
the next turn end. If `/compact` was refused but the resume prompt went out,
or the compaction was skipped, the request is dropped and a toast says why;
Claude can ask again.

## Development

```bash
claude plugin test .
claude plugin validate .
```

## License

MIT
