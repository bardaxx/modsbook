# spec-flow

A Claude Code mod that docks a side pane beside the transcript and follows a spec from idea to merge: which stage the work is in, what each subagent is doing right now, and how far the tickets have come.

It is built around the idea-to-ship spine of [AI Hero's skills](https://www.aihero.dev/skills): `/grill-me` → `/to-spec` → `/to-tickets` → `/implement-spec` → `/code-review` → PR.

```text
╭─────────────────────────────────────────────╮
│ ◆ flow                         spec #237 40% │
│ Builder, track panel and Episodes            │
│ PR #243 · open · feat/builder-feedback  CI ✓ │
│                                              │
│ grill ▸ spec ▸ tickets ▸ implement ▸ review ▸ │
╰─────────────────────────────────────────────╯
╭─────────────────────────────────────────────╮
│ ◆ agents                   ■ ■ □ 2/3 slots   │
│ ● implementer #241 · Implement #241    ↻ 3m  │
│  Bash mise run lint                          │
│ ✓ merger #239 · Merged cleanly          12m  │
╰─────────────────────────────────────────────╯
╭─────────────────────────────────────────────╮
│ ◆ tickets                       2 of 5 done  │
│ ████████████████▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░ │
│ ■ done 2  ■ in progress 1  ■ ready 1  ■ …    │
│                                              │
│ ■ #238 reopen an acknowledged warning merged │
│ ■ #241 Create episode opens…    implementer  │
│ ■ #240 a row preview replaces…   after #239  │
╰─────────────────────────────────────────────╯
```

## What it shows

- **flow**: the spec being followed, its integration PR with its CI state, and the stage. A skill that runs sets the stage; a spec followed with `/flow spec <n>` takes it from its tickets and PR.
- **agents**: each subagent this session spawns, with its role (implementer, merger, reviewer, explorer, read from its description), the tickets it names, the tool it is running now and how long it has run. The slot meter counts running implementers against the three slots `/implement-spec` allows.
- **tickets**: the spec's sub-issues as one bar split by state, a legend, and one row per ticket: closed, merged into the integration branch, being merged, implemented and waiting for a merge, in progress, ready (on the frontier), or blocked by the tickets it waits for.

## Requirements

- Claude Code with function-hook mods (2.1.292 or later).
- The [GitHub CLI](https://cli.github.com), signed in, run from a checkout of the repository whose issues hold the spec.
- Specs and tickets laid out the way `/to-spec` and `/to-tickets` publish them: tickets are sub-issues of the spec, their blockers either a `## Blocked by` section or GitHub's native blocking links.

## Install

At the prompt of a Claude Code terminal session:

```text
/plugin install spec-flow --marketplace bardaxx/spec-flow
```

Answer `y` to add the marketplace, then pick a scope (Enter takes the user scope).

To run it from a clone while you change it:

```sh
claude --plugin-dir /path/to/spec-flow
```

## Use

| Command | What it does |
| --- | --- |
| `/flow` | Opens the pane. |
| `/flow spec <n>` | Follows spec issue `#n` and loads its tickets. |
| `/flow refresh` | Reads the spec, its tickets and its PR from GitHub again. |
| `/flow clear` | Forgets the spec, the agents and the stage. |

In the pane, `r` refreshes and `c` clears. The pane opens by itself when a flow skill runs, as a sidebar from 144 terminal columns; below that, open it with `/flow`. It also refreshes every minute and whenever an implementer or a merger finishes.

The spec is picked up without a command too: from the argument of `/implement-spec` or `/to-tickets`, or from the issue `/to-spec` creates.

## How it knows

| It shows | It reads |
| --- | --- |
| stage | the skills that run (`skill.prompt`, the Skill tool, a typed `/skill`), else the tickets and the PR |
| agents | `agent.spawn`, each subagent's `tool.call`, and its `turn.complete` |
| tickets | `gh api …/issues/<spec>/sub_issues`, and `…/dependencies/blocked_by` where the body names no blockers |
| merged | the merge commits of the spec's PR that name a ticket (`Merge #239: …`, `feat: merge … (#238)`) |
| PR and CI | the PR whose title or body names `#<spec>`, and its `statusCheckRollup` |

## Limits

- A mod sees the subagents of its own session only. Run `/implement-spec` in the session that shows the pane, or the agents card and the slot meter stay empty; ticket progress still shows, since it comes from GitHub.
- An agent's role and tickets are read from its Agent call: name the role and the `#ticket` in the description.

## Develop

```sh
claude plugin validate .
claude plugin test .
```

Claude Code writes the API's types into `.claude-plugin/types/` when it loads the mod, and `tsconfig.json` extends them, so `tsc -p .` type-checks it after the first load.

## License

MIT
