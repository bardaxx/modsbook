# wayfinder-map

A Claude Code mod that docks a side pane beside the transcript and draws a [`/wayfinder`](https://www.aihero.dev/skills-wayfinder) map: the route of decision tickets from start to destination as a graph you can walk with the arrows, the decisions taken so far, the fog not yet specified, and in each ticket's card its Spine: the grilling rounds, the facts looked up and the docs written while it was worked.

```text
                                       ⚑ Start
                    A foggy idea, with no idea how to get there
                                          │
                                          ▼
                             ╭───┬─────────────────────╮
                             │ ? │ ✓ Who is it for     │
                             ╰───┴────────┬────────────╯
                                          │
             ╭────────────────────────────┼────────────────────────────╮
             ▼                            ▼                            ▼
╭───┬─────────────────────╮  ╭───┬─────────────────────╮  ╭───┬─────────────────────╮
│ ≡ │ ▶ Stand up the sand…│  │ ? │ ◇ Pricing model     │  │ ⌕ │ ◇ Competitor APIs   │
╰───┴────────┬────────────╯  ╰───┴────────┬────────────╯  ╰───┴────────┬────────────╯
             │                            │                            │
             ╰──────────────╮             │              ╭─────────────╯
                            ├─────────────┴──────────────┤
                            ▼                            ▼
               ╭───┬─────────────────────╮  ╭───┬─────────────────────╮
               │ ◫ │ ○ Onboarding flow s…│  │ ? │ ○ Launch scope      │
               ╰───┴────────┬────────────╯  ╰───┴────────┬────────────╯
                            │                            │
                            ╰─────────────╮              │
                                          ├──────────────╯
                                          ▼
                                    ⚑ Destination
                         All tasks on the map are complete.
```

## What it shows

- **header**: the map's title, its destination, and one bar split by ticket state: resolved, claimed, on the frontier (open, unblocked, unclaimed), or blocked. Fog counts beside it. Under the destination, **Spine · charting**: what was asked and written with no ticket claimed. It is drawn open while the map has no tickets; once it has some, every level is folded, until a round comes in between one claim and the next.
- **map** (`m`): the map as a graph, drawn the way the wayfinder article draws it. **Start** (the map's title) sits on top and **Destination** at the bottom. Each ticket is a box in the row of its depth, with arrows from the tickets that block it. A box's border and icon give its type: `?` grilling, `◫` prototype, `⌕` research, `≡` task. The mark before its title gives its state: `✓` resolved, `●` claimed, `◇` on the frontier (open, unblocked, unclaimed), `○` blocked, `▶` next (the first frontier ticket in map order, the one `/wayfinder` takes). Out-of-scope tickets stay off the map, and the map's **Not yet specified** section shows below it as fog.
- **navigating it**: click the graph (or a box), then use the arrows (or `h` `j` `k` `l`). Up and down follow the blocking edges first, left and right move along a row. The selected box gets a double border, its edges light up, and its card opens below. `⏎` closes or reopens the card. Without giving the graph the keys, `n` and `p` step through the tickets row by row. On a map wider than the pane, the view scrolls to keep the selected box in sight.
- **ticket**: the card of the selected ticket: its question, what it waits for and what it unblocks, whether it is worked with a human (HITL) or by the agent alone (AFK), and once resolved its answer (the `## Answer` of a local ticket, or the last comment of a GitHub one). Under them, its **Spine**, drawn as [grill-map](../grill-map) draws a grill, from the same file. A long Spine makes the card longer, and the pane scrolls. `x` closes the card.
  - Each round is a level, `L1`, `L2`, …. On an open ticket the newest level is drawn whole: each question's body, the choices, the recommendation (`➡`, `✓` when taken) and the person's own answer (`✎`). Older levels fold to one line per decision. A click or a tap on a level's heading folds or unfolds it, and `a` (the `Unfold` / `Fold` button) does every level at once.
  - Between the levels: `⌕` a fact looked up (a sub-agent, or a run of reads folded into one line), `≡` the glossary terms written, `⚑` an ADR.
  - `◎ wrap-up` is the summary put to the person once the rounds are answered, and `◉` marks it confirmed.
  - A resolved ticket's card shows its Spine with every level folded and the confirmed wrap-up last.
- **decisions** (`d`): the map's **Decisions so far**, one gist per resolved ticket, then **Out of scope** and the map's **Notes**.
### What lands on a Spine

Only a **Run** writes to a Spine. A Run starts with `/wayfinder` and lasts until `/clear`, a `/grill-me` or `/grill-with-docs` you ask for, or `/waymap clear`. A map you open by hand with `/waymap` is shown, not grilled into.

- Inside a Run, each line goes to the ticket claimed in this session. With none claimed, it goes to charting.
- Once a ticket closes, later lines go to charting until the next claim.
- Once the map has tickets, charting keeps no lookups: those are a session reading the map to choose a ticket.
- The status line names the ticket being worked and where its Spine stands, `Pick the storage engine · L2 · 2 open`, or `charting · …` with no ticket claimed. Outside a Run there is none.

Spines are kept per map across sessions, up to 400 lines a map. When a map goes over, the oldest lookups are dropped first, never a level or a wrap-up. After that go the oldest lines of resolved tickets, never those of the open ticket or of charting.

## Requirements

- Claude Code with function-hook mods (2.1.292 or later).
- A map laid out the way `/wayfinder` charts one, on either tracker [`setup-matt-pocock-skills`](https://github.com/mattpocock/skills) configures:
  - **GitHub**: the map is an issue labelled `wayfinder:map`, its tickets sub-issues (or a task list in its body) labelled `wayfinder:<type>`, blocked through GitHub's native dependencies or a `Blocked by: #n` line. Needs the [GitHub CLI](https://cli.github.com), signed in, run from a checkout of the repository.
  - **Local markdown**: `.scratch/<effort>/map.md` and one `.scratch/<effort>/issues/NN-<slug>.md` per ticket, with `Type:`, `Status:` and `Blocked by:` lines.

## Install

At the prompt of a Claude Code terminal session, add the marketplace (once), then install the mod:

```text
/plugin marketplace add bardaxx/modsbook
/plugin install wayfinder-map@modsbook
```

Pick a scope when asked (Enter takes the user scope).

To update it:

```sh
claude plugin update wayfinder-map@modsbook
```

To run it from a clone while you change it:

```sh
claude --plugin-dir /path/to/modsbook/mods/wayfinder-map
```

## Use

| Command | What it does |
| --- | --- |
| `/waymap` | Opens the pane, following the map it already follows, or else the newest `.scratch/*/map.md`, or else the newest open `wayfinder:map` issue. |
| `/waymap <n>` or `/waymap <issue URL>` | Follows the map in GitHub issue `#n`. |
| `/waymap .scratch/<effort>` | Follows a local map. |
| `/waymap refresh` | Reads the map and its tickets again. |
| `/waymap clear` | Forgets the map followed in this session, and ends the Run. |

In the pane, `m` and `d` switch tabs, `n` and `p` step through the tickets, `x` closes a ticket's card, `a` unfolds or folds every level, `r` refreshes and `c` clears. On mobile, which has no region for the graph, the map tab draws the route as an indented tree instead: a digit or a tap opens a ticket, and its card carries the same Spine, levels folded and unfolded by a tap. VS Code draws no mod panes yet.

Mostly no command is needed. The pane opens when `/wayfinder` runs: with a map as its argument it follows that map, and with a loose idea it waits for the map to be created (the `gh issue create --label wayfinder:map` call, or the write of `.scratch/<effort>/map.md`) and follows it from there. It reads the map again after each `gh issue` or `gh api` call that changes the tracker, after each write under `.scratch/`, and every minute.

## How it knows

| It shows | It reads |
| --- | --- |
| map, destination, decisions, fog, out of scope | the map's body: `## Destination`, `## Notes`, `## Decisions so far`, `## Not yet specified`, `## Out of scope` |
| tickets, types, claims | `gh api …/issues/<map>/sub_issues` (labels, assignees, state), or the local issue files' `Type:` and `Status:` lines |
| blocking edges | a `Blocked by:` line, else `…/issues/<n>/dependencies/blocked_by` |
| out of scope | a ticket the map's **Out of scope** section links, or one closed as not planned |
| the ticket this session works | `gh issue edit <n> --add-assignee`; `Status: claimed` written to a local ticket, by a write or by a shell command naming its file |
| levels | each main-loop answer holding `❓ **Q1** - **Title**: …` and `➡️ …`, the grilling skill's round format, and the person's next prompt (`1. yes`, `Q2: no, …`, or one answer for all; a yes followed by a reserve such as `ma` or `but` is the person's own answer) |
| dialogs | each AskUserQuestion call and the answers it returned; an option labelled `(Recommended)` is the recommendation |
| lookups, terms, ADRs | each main-loop `Agent` call, read and search; each `Write` or `Edit` of a `GLOSSARY.md`, `CONTEXT.md` or `docs/adr/NNNN-slug.md` |
| wrap-up | the first answer without questions after a level is answered, and the person's reply to it |

## Limits

- A reply that answers a round in prose, without numbering, is kept whole under the round rather than split across its questions.
- Arrows that share a column merge, as on any line drawing: where two blockers feed the same ticket, the card lists them by name.
- Keys reach the graph once a click has given it the focus; `n` and `p` work without it.
- A GitHub ticket's answer is read on demand, when its card opens.

## Develop

From this folder:

```sh
claude plugin validate .
claude plugin test .
```

Claude Code writes the API's types into `.claude-plugin/types/` when it loads the mod, and `tsconfig.json` extends them, so `tsc -p .` type-checks it after the first load.

## License

MIT, see the [repository's license](../../LICENSE).
