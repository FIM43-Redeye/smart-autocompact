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
- **What you said, at the strength you meant it.** A summary flattens what
  you told Claude along the way: a requirement gets dropped, or a passing
  thought hardens into a rule. The procedure has Claude keep a list in the
  first record of what you said about how the work should go, in your own
  words, each with how firmly it understands you to have meant it: something
  that has to hold, a preference, a thought you were still turning over. That
  judgment is Claude's to make, and not from tone alone. Where you left
  something open, it stays open. When Claude is unsure and the work turns on
  it, it can ask you; if you are away, it notes an open question and carries
  on with its best reading. Claude edits the list instead of rewriting it,
  and takes out what you lifted or what belonged to a finished task.
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

Answer `y` to add the marketplace, then pick a scope. User scope turns it on
in every project on that computer.

From a shell:

```bash
claude plugin install smart-autocompact --marketplace FIM43-Redeye/smart-autocompact
```

In the desktop app, where `/plugin` does not run: click + next to the prompt
box, then Plugins, then Add marketplace with `FIM43-Redeye/smart-autocompact`,
then Add plugin.

The terminal, the desktop app's local sessions and the VS Code extension on
one computer share their settings, so one install covers all three. Each
computer needs its own install. Cloud sessions do not load installed plugins.

## Updates

The plugin sets no version, so the latest commit on `main` is its version and
every push to `main` is an update.

Claude Code does not auto-update a third-party marketplace until you turn it
on, once per computer. In a terminal session, run `/plugin`, open the
**Marketplaces** tab, select `smart-autocompact`, and choose **Enable
auto-update**.

Or put it in `~/.claude/settings.json`, which the desktop app reads too. The
block also registers the marketplace and turns the plugin on, so the same
lines set up any computer:

```json
{
  "extraKnownMarketplaces": {
    "smart-autocompact": {
      "source": { "source": "github", "repo": "FIM43-Redeye/smart-autocompact" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "smart-autocompact@smart-autocompact": true
  }
}
```

With auto-update on, Claude Code checks a few minutes into a session (up to
ten after your first message) and updates the copy on disk. The running
session keeps the version it loaded: run `/reload-plugins` to switch, or the
next session picks it up. To update right away:

```bash
claude plugin update smart-autocompact@smart-autocompact
```

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

`main` is what installed copies update from, so work goes on a branch first.
To try a branch before merging it, check it out and start a terminal session
on that copy. It replaces the installed plugin for that session only:

```bash
claude --plugin-dir /path/to/smart-autocompact
```

The desktop app takes no flags. There, set `CLAUDE_CODE_PLUGIN_DIRS` to the
copy's absolute path in the `env` block of `~/.claude/settings.json` while
you test, and take it out afterwards.

## License

MIT
