# skillmaps

A Claude Code mod of three side panes, one for each stretch of the road the [AI Hero skills](https://www.aihero.dev/skills) follow:

| Map | What it draws |
| --- | --- |
| [grill-map](#grill-map) | `/grill-me`, `/grill-with-docs` and `/grilling`: the design tree read top to bottom, one level per round, with each recommendation, what was chosen, the lookups and the docs written. |
| [wayfinder-map](#wayfinder-map) | `/wayfinder`: the map as a navigable graph from start to destination, the decisions so far, the fog, and each ticket's grilling as a design tree. |
| [spec-map](#spec-map) | A spec from idea to merge: the stage, what each subagent is doing, the tickets and the integration PR. |

Each pane opens with the same header: `SKILLMAPS · <MAP> <STATE>` with the map in its own color, a legend of the maps turned on (a press on one opens it), and a strip of braille dots each map animates its own way: grill-map's flames, wayfinder-map's traveller in the fog, spec-map's conveyor. It moves every frame while the map works and at a slower beat at rest.

In a Claude Code session, a pane docks beside the transcript. Here grill-map follows a `/grill-with-docs`: the first round settled, the lookups and docs it led to, and the next round waiting for your answer. While the model works, the header's flames flicker; while the round waits, they rest, dim.

```text
╭────────────────────────────────────────────────────┬─ grill-map ──────────────────────────────────────╮
│ > /grill-with-docs offline sync for the field app  │         SKILLMAPS · GRILL-MAP YOUR TURN          │
│                                                    │     ■ grill-map  ■ wayfinder-map  ■ spec-map     │
│ ● Q1 - Storage: … ➡ SQLite, with WAL               │ ⣄⣀⣠⣄⣴⣀⠀⠀⡀⢀⣠⣴⣤⣄⣤⣦⣶⣴⣤⣤⢀⠀⡀⡀⣄⣀⣀⢨⢀⣠⣤⣶⣾⣴⣬⣠⣨⣤⣄⣄⣀⢀⢀⣠⣠⣴⣤⣴ │
│ ● Q2 - Sync trigger: … ➡ on every change           │                                                  │
│                                                    │ ╭──────────────────────────────────────────────╮ │
│ > 1. yes  2. no, every minute                      │ │ ◆ grill-with-docs                       2/3  │ │
│                                                    │ │ Offline sync for the field app               │ │
│ ● Read(src/sync/queue.ts)                          │ │                                              │ │
│   ⎿  Read 182 lines                                │ │ ███████████████████████████████▓▓▓▓▓▓▓▓▓▓▓▓▓ │ │
│ ● Update(CONTEXT.md)                               │ │ ✓ took 1  ✎ yours 1  ◌ open 1  ⌕ lookups 3   │ │
│   ⎿  Added 1 line                                  │ ╰──────────────────────────────────────────────╯ │
│ ● Write(docs/adr/0001-sqlite-on-the-device.md)     │ ╭──────────────────────────────────────────────╮ │
│   ⎿  Wrote 24 lines                                │ │ Spine                    2 levels · 1 open   │ │
│                                                    │ │ ◎ started                           6m ago   │ │
│ ● Q3 - Conflicts: where does a conflict            │ │ ┃ ⌕ agent · Find the current sync code done  │ │
│   surface to the person, if anywhere at all?       │ │ ┃ ⌕ 2 lookups · queue.ts                     │ │
│   ➡ Last write wins, with a banner                 │ │ ┃                                            │ │
│                                                    │ │ ● L1 · 2/2 settled ▸                    4m   │ │
│                                                    │ │ ┃ ✓ Storage → SQLite, with WAL               │ │
│                                                    │ │ ┃ ✎ Sync trigger → no, every minute          │ │
│                                                    │ │ ┃ ≡ CONTEXT.md · Sync Log                    │ │
│                                                    │ │ ┃ ⚑ ADR 0001 · SQLite on the device          │ │
│                                                    │ │ ┃                                            │ │
│                                                    │ │ ◆ L2 · waiting for you ▾                1m   │ │
│                                                    │ │ ┃ ◌ Q3 Conflicts                             │ │
│                                                    │ │ ┃ │ Where does a conflict surface to the     │ │
│                                                    │ │ ┃ │ person, if anywhere at all?              │ │
│ ╭────────────────────────────────────────────────╮ │ │ ┃ │ ➡ Last write wins, with a banner         │ │
│ │ >                                              │ │ │ ┃                                            │ │
│ ╰────────────────────────────────────────────────╯ │ │ ▼ 1 open · reply by number, 1. yes  2. …     │ │
│   ⏵⏵ accept edits on                               │ ╰──────────────────────────────────────────────╯ │
╰────────────────────────────────────────────────────┴──────────────────────────────────────────────────╯
```

## Requirements

- Claude Code with function-hook mods (2.1.292 or later).
- The skills each map follows, listed under its section. They come from [mattpocock/skills](https://github.com/mattpocock/skills), which skillmaps depends on: installing it installs `mattpocock-skills@claude-plugins-official` too, from Anthropic's own marketplace. The maps read the skills under that plugin's names (`/mattpocock-skills:grill-me`) as well as bare (`/grill-me`).

If you already keep those skills in `~/.claude/skills/` or a project's `.claude/skills/`, the plugin adds them a second time under its prefix. Remove your copies to keep one set, or keep both: the maps follow either.

## Install

At the prompt of a Claude Code terminal session, add the marketplace (once), then install the mod:

```text
/plugin marketplace add bardaxx/modsbook
/plugin install skillmaps@modsbook
```

Pick a scope when asked (Enter takes the user scope). The settings screen comes next: every map is on, turn off the ones you do not want.

### Settings

| Setting | Default | What it does |
| --- | --- | --- |
| `grill-map` | on | The grill pane and its status line. |
| `wayfinder-map` | on | The wayfinder pane, its Run and its status line. |
| `spec-map` | on | The spec pane. |
| `spec-map implementer slots` | `0` | How many implementers may run at once, drawn as spec-map's slot meter. `0` reads the cap from the implement skill's text (`3 slots`), or draws none when the skill states none. |

Change them later in `/plugin`, under skillmaps, or in `/config`; a change reloads the mod. A map turned off registers none of its hooks.

### Coming from grill-map, wayfinder-map or spec-map

The three were one mod each before. Uninstall the ones you have, then install skillmaps:

```text
/plugin uninstall grill-map@modsbook
/plugin uninstall wayfinder-map@modsbook
/plugin uninstall spec-map@modsbook
/plugin install skillmaps@modsbook
```

What they kept for a session does not carry over.

### Update

```sh
claude plugin update skillmaps@modsbook
```

The new version loads in the next session, or at once with `/reload-plugins`. To get updates without asking, turn on auto-update for modsbook in `/plugin`, under Marketplaces; it is off by default.

To run it from a clone while you change it:

```sh
claude --plugin-dir /path/to/modsbook/mods/skillmaps
```

## Use

Each pane opens by itself when its skill runs. One command reaches them all:

| Command | What it does |
| --- | --- |
| `/skillmaps` | Opens the pane used last, or the first one turned on. |
| `/skillmaps grill` | Opens grill-map. |
| `/skillmaps wayfinder [<map>]` | Opens wayfinder-map, following a map: an issue number or a `.scratch/<effort>` folder. |
| `/skillmaps spec [<n>]` | Opens spec-map, following spec issue `#n`. |

Each map's section lists the rest of its words (`refresh`, `clear`).

## grill-map

A side pane beside the transcript that draws a grilling session as a map of its choices, read top to bottom: [`/grill-me`](https://www.aihero.dev/skills-grill-me), [`/grill-with-docs`](https://www.aihero.dev/skills-grill-with-docs), or [`/grilling`](https://www.aihero.dev/skills-grilling) itself. Each round is one level of the design tree on a vertical spine, its questions hanging from it with the recommendation and what was chosen, and between the levels the facts the agent looked up and the docs it wrote.

```text
        SKILLMAPS · GRILL-MAP YOUR TURN
    ■ grill-map  ■ wayfinder-map  ■ spec-map
⣶⣤⣴⣠⣤⣤⣤⣶⣄⡄⡀⠀⠀⣁⣤⣤⣦⣄⣴⣬⣶⣶⣤⣀⡀⢀⣤⣠⣄⣬⢀⠀⢀⣴⣼⣦⣤⣆⢀⣀⣄⣆⣄⣀⡀⠀⣀⣄

╭──────────────────────────────────────────────╮
│ ◆ grill-with-docs                       2/3  │
│ Offline sync for the field app               │
│                                              │
│ ███████████████████████████████▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│ ✓ took 1  ✎ yours 1  ◌ open 1  ⌕ lookups 3   │
╰──────────────────────────────────────────────╯
╭──────────────────────────────────────────────╮
│ Spine                    2 levels · 1 open   │
│ ◎ started                           6m ago   │
│ ┃ ⌕ agent · Find the current sync code done  │
│ ┃ ⌕ 2 lookups · queue.ts                     │
│ ┃                                            │
│ ● L1 · 2/2 settled ▸                    4m   │
│ ┃ ✓ Storage → SQLite, with WAL               │
│ ┃ ✎ Sync trigger → no, every minute          │
│ ┃ ≡ CONTEXT.md · Sync Log                    │
│ ┃ ⚑ ADR 0001 · SQLite on the device          │
│ ┃                                            │
│ ◆ L2 · waiting for you ▾                1m   │
│ ┃ ◌ Q3 Conflicts                             │
│ ┃ │ Where does a conflict surface to the     │
│ ┃ │ person, if anywhere at all?              │
│ ┃ │ ➡ Last write wins, with a banner         │
│ ┃                                            │
│ ▼ 1 open · reply by number, 1. yes  2. …     │
╰──────────────────────────────────────────────╯
```

### What it shows

- **header**: the skill that started the grill, its subject, the questions settled out of those asked, and one bar split by how each stands: `✓` took the recommendation, `✎` answered otherwise, `⏎` answered in a reply that was not split by number, `◌` still open. Beside it, the lookups, the glossary terms (`≡`) and the ADRs (`⚑`) of the grill.
- **Spine**: the design tree, top to bottom, drawn as [wayfinder-map](#wayfinder-map) draws each ticket's, from the same file.
  - Each round is a level, `L1`, `L2`, …: the frontier as it stood, every question whose prerequisites were settled. The newest level is drawn whole: each question's body, the choices it offered, the recommendation (`➡`, `✓` when the person said yes) and what the person answered instead (`✎`). An older level folds to one line per decision, `title → what was chosen`; a click or a tap on its heading unfolds it. Once the grill is confirmed, every level folds. Each new level takes the focus: when it arrives every level before it folds, one unfolded by hand too.
  - An AskUserQuestion dialog asked during the grill is a level too, the option picked marked `●`.
  - `⌕` marks a fact the agent went to find instead of asking: a sub-agent, running until it reports, or a run of reads and searches folded into one line.
  - `≡` marks the terms written to `CONTEXT.md` or `GLOSSARY.md`, and `⚑` each ADR written under `docs/adr/` (`/grill-with-docs`, through `domain-modeling`).
  - `◎ wrap-up` is the turn that ends without questions once the rounds are answered: the frontier is empty and the summary waits for the person's word. A yes closes the grill, `◉ shared understanding confirmed`; a yes with a reserve (`sì, ma …`, `yes, but …`) or anything else pushes it back, and the next wrap-up is put to the person again.
  - `▼` says where the tree goes next: the questions still open, a lookup running, or the next frontier being worked out.
- **status line**: while a grill is open, its level and what waits on the person, `grill L2 · 2 open`, or `grill · confirm the shared understanding` at the wrap-up. It goes once the grill is confirmed or cleared.

A session can hold several grills: each new `/grill-me` or `/grill-with-docs` starts one, and `p` / `n` page through them.

#### Inside `/wayfinder`

With wayfinder-map turned on too, a `/wayfinder` Run is wayfinder-map's: grill-map reads it and follows it.

- Its status line goes, and wayfinder-map's carries the ticket being worked.
- It opens one grill per claimed ticket, named after the ticket, and a `charting` grill for the rounds asked with no ticket claimed.
- The Run ends on `/clear`, on a `/grill-me` or `/grill-with-docs` you ask for, or on `/skillmaps wayfinder clear`; grill-map then holds grills of its own again.

With wayfinder-map turned off, a `/wayfinder` grill is a grill like any other.

### Requirements

- The grilling skills from [mattpocock/skills](https://github.com/mattpocock/skills): `grilling`, and the `grill-me` or `grill-with-docs` wrapper (`grill-with-docs` also needs `domain-modeling`).

### Use

No command is needed: the pane opens when `/grill-me`, `/grill-with-docs` or `/grilling` runs, or when an answer holds a round in the grilling format.

| Command | What it does |
| --- | --- |
| `/skillmaps grill` | Opens the pane. |
| `/skillmaps grill clear` | Forgets the grills of this session. |

In the pane, a click or a tap on a level's heading folds or unfolds it, `a` (or the `Unfold` / `Fold` button) unfolds every level or folds them back, `p` and `n` show the previous and next grill, and `c` clears.

### How it knows

| It shows | It reads |
| --- | --- |
| the grill and its subject | the `grill-me`, `grill-with-docs` or `grilling` skill's prompt and its arguments; with none, the next prompt (a wrapper) or the last one (`/grilling` the model invoked) |
| a level | each main-loop answer holding `❓ **Q1** - **Title**: …` and `➡️ …`, the grilling skill's round format |
| what was chosen | the person's next prompt: `1. yes`, `Q2: no, …`, or one answer for all; a yes followed by a reserve (`ma`, `però`, `tranne`, `but`, `unless`, …) is the person's own answer |
| lookups | each main-loop `Agent` call during the grill, and its `Read`, `Grep`, `Glob`, `WebFetch`, `WebSearch` and read-only shell calls (`rg`, `grep`, `cat`, `ls`, `find`, `git log`, …) |
| terms | each `Write` or `Edit` of a `CONTEXT.md` or `GLOSSARY.md`: the `**Term**:` lines it adds |
| ADRs | each `Write` or `Edit` of `docs/adr/NNNN-slug.md`, titled by its `# ` heading |
| wrap-up | the first answer without questions after a round is answered, and the person's reply to it |
| dialogs | each AskUserQuestion call and the answers it returned; an option labelled `(Recommended)` is the recommendation |

### Limits

- A reply that answers a round in prose, without numbering, is kept whole under the level rather than split across its questions.
- A reply is read as a yes when it opens with one (`yes`, `ok`, `sì`, `lgtm`, …) and no reserve follows. The grilling skill words each question so that yes takes its recommendation; a question worded against its recommendation is read the same way.
- A yes with a reserve said whole to a round of several questions stays unsplit (`⏎`): the reserve cannot be pinned to one question.
- A level is the round as the agent asked it: when the agent puts dependent questions in the same round, they sit on the same level.
- The wrap-up is read from the shape of the turn. An answer that ends without questions for another reason, such as a pause to look something up, shows as a wrap-up until the next round arrives.
- Grills are kept for the session, not across sessions.

## wayfinder-map

A side pane beside the transcript that draws a [`/wayfinder`](https://www.aihero.dev/skills-wayfinder) map: the route of decision tickets from start to destination as a graph you can walk with the arrows, the decisions taken so far, the fog not yet specified, and in each ticket's card its Spine: the grilling rounds, the facts looked up and the docs written while it was worked.

```text
                           SKILLMAPS · WAYFINDER-MAP CLAIMED
                        ■ grill-map  ■ wayfinder-map  ■ spec-map
⠀⠠⠀⠀⠁⢠⠀⠀⠀⠀⠀⠀⡀⠀⢔⠀⠀⠐⠀⠀⠒⠀⠁⠀⠊⠀⠀⠈⠀⠄⠀⠀⠈⠀⡀⠀⠁⠐⠀⠀⠐⠀⠀⠀⡀⠐⠅⠂⠀⠐⢂⢐⠬⣝⠞⢕⡄⠂⡐⡀⠐⢉⠀⠀⠀⠀⡄⠂⠂⠄⠀⠀⠑⠀⠈⠒⠀⡀⠀⠈⠐⠀⠄⠅⠉⠀⠀⠀

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

### What it shows

- **header**: the map's title, its destination, and one bar split by ticket state: resolved, claimed, on the frontier (open, unblocked, unclaimed), or blocked. Fog counts beside it. Under the destination, **Spine · charting**: what was asked and written with no ticket claimed. It is drawn open while the map has no tickets; once it has some, every level is folded, until a round comes in between one claim and the next.
- **map** (`m`): the map as a graph, drawn the way the wayfinder article draws it. **Start** (the map's title) sits on top and **Destination** at the bottom. Each ticket is a box in the row of its depth, with arrows from the tickets that block it. A box's border and icon give its type: `?` grilling, `◫` prototype, `⌕` research, `≡` task. The mark before its title gives its state: `✓` resolved, `●` claimed, `◇` on the frontier (open, unblocked, unclaimed), `○` blocked, `▶` next (the first frontier ticket in map order, the one `/wayfinder` takes). Out-of-scope tickets stay off the map, and the map's **Not yet specified** section shows below it as fog.
- **navigating it**: click the graph (or a box), then use the arrows (or `h` `j` `k` `l`). Up and down follow the blocking edges first, left and right move along a row. The selected box gets a double border, its edges light up, and its card opens below. `⏎` closes or reopens the card. Without giving the graph the keys, `n` and `p` step through the tickets row by row. On a map wider than the pane, the view scrolls to keep the selected box in sight.
- **ticket**: the card of the selected ticket: its question, what it waits for and what it unblocks, whether it is worked with a human (HITL) or by the agent alone (AFK), and once resolved its answer (the `## Answer` of a local ticket, or the last comment of a GitHub one). Under them, its **Spine**, drawn as [grill-map](#grill-map) draws a grill, from the same file. A long Spine makes the card longer, and the pane scrolls. `x` closes the card.
  - Each round is a level, `L1`, `L2`, …. On an open ticket the newest level is drawn whole: each question's body, the choices, the recommendation (`➡`, `✓` when taken) and the person's own answer (`✎`). Older levels fold to one line per decision. A click or a tap on a level's heading folds or unfolds it, and `a` (the `Unfold` / `Fold` button) does every level at once.
  - Between the levels: `⌕` a fact looked up (a sub-agent, or a run of reads folded into one line), `≡` the glossary terms written, `⚑` an ADR.
  - `◎ wrap-up` is the summary put to the person once the rounds are answered, and `◉` marks it confirmed.
  - A resolved ticket's card shows its Spine with every level folded and the confirmed wrap-up last.
- **decisions** (`d`): the map's **Decisions so far**, one gist per resolved ticket, then **Out of scope** and the map's **Notes**.
#### What lands on a Spine

Only a **Run** writes to a Spine. A Run starts with `/wayfinder` and lasts until `/clear`, a `/grill-me` or `/grill-with-docs` you ask for, or `/skillmaps wayfinder clear`. A map you open by hand with `/skillmaps wayfinder` is shown, not grilled into.

- Inside a Run, each line goes to the ticket claimed in this session. With none claimed, it goes to charting.
- Once a ticket closes, later lines go to charting until the next claim.
- Once the map has tickets, charting keeps no lookups: those are a session reading the map to choose a ticket.
- The status line names the ticket being worked and where its Spine stands, `Pick the storage engine · L2 · 2 open`, or `charting · …` with no ticket claimed. Outside a Run there is none.

Spines are kept per map across sessions, up to 400 lines a map. When a map goes over, the oldest lookups are dropped first, never a level or a wrap-up. After that go the oldest lines of resolved tickets, never those of the open ticket or of charting.

### Requirements

- A map laid out the way `/wayfinder` charts one, on either tracker [`setup-matt-pocock-skills`](https://github.com/mattpocock/skills) configures:
  - **GitHub**: the map is an issue labelled `wayfinder:map`, its tickets sub-issues (or a task list in its body) labelled `wayfinder:<type>`, blocked through GitHub's native dependencies or a `Blocked by: #n` line. Needs the [GitHub CLI](https://cli.github.com), signed in, run from a checkout of the repository.
  - **Local markdown**: `.scratch/<effort>/map.md` and one `.scratch/<effort>/issues/NN-<slug>.md` per ticket, with `Type:`, `Status:` and `Blocked by:` lines.

### Use

| Command | What it does |
| --- | --- |
| `/skillmaps wayfinder` | Opens the pane, following the map it already follows, or else the newest `.scratch/*/map.md`, or else the newest open `wayfinder:map` issue. |
| `/skillmaps wayfinder <n>` or `/skillmaps wayfinder <issue URL>` | Follows the map in GitHub issue `#n`. |
| `/skillmaps wayfinder .scratch/<effort>` | Follows a local map. |
| `/skillmaps wayfinder refresh` | Reads the map and its tickets again. |
| `/skillmaps wayfinder clear` | Forgets the map followed in this session, and ends the Run. |

In the pane, `m` and `d` switch tabs, `n` and `p` step through the tickets, `x` closes a ticket's card, `a` unfolds or folds every level, `r` refreshes and `c` clears. On mobile, which has no region for the graph, the map tab draws the route as an indented tree instead: a digit or a tap opens a ticket, and its card carries the same Spine, levels folded and unfolded by a tap. VS Code draws no mod panes yet.

Mostly no command is needed. The pane opens when `/wayfinder` runs: with a map as its argument it follows that map, and with a loose idea it waits for the map to be created (the `gh issue create --label wayfinder:map` call, or the write of `.scratch/<effort>/map.md`) and follows it from there. It reads the map again after each `gh issue` or `gh api` call that changes the tracker, after each write under `.scratch/`, and every minute.

### How it knows

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

### Limits

- A reply that answers a round in prose, without numbering, is kept whole under the round rather than split across its questions.
- Arrows that share a column merge, as on any line drawing: where two blockers feed the same ticket, the card lists them by name.
- Keys reach the graph once a click has given it the focus; `n` and `p` work without it.
- A GitHub ticket's answer is read on demand, when its card opens.

## spec-map

A side pane beside the transcript that follows a spec from idea to merge: which stage the work is in, what each subagent is doing right now, and how far the tickets have come.

It is built around the idea-to-ship spine of [AI Hero's skills](https://www.aihero.dev/skills): `/grill-me` → `/to-spec` → `/to-tickets` → `/implement-spec` → `/code-review` → PR.

```text
         SKILLMAPS · SPEC-MAP IMPLEMENT
    ■ grill-map  ■ wayfinder-map  ■ spec-map
⢾⣧⠶⠄⡭⡷⠮⠄⠤⠤⠄⠄⢭⢯⢭⠄⠄⠄⠤⠄⠤⠤⠤⠤⠤⠤⠤⠄⠄⠤⠤⠤⠄⠤⠤⠄⠼⣷⡿⠤⣵⣽⡽⠄⣿⢾⣭⠤⢷

╭───────────────────────────────────────────────╮
│ ◆ flow                          spec #237 40% │
│ Builder, track panel and Episodes             │
│ PR #243 · open · feat/builder-feedback   CI ✓ │
│                                               │
│ grill ▸ spec ▸ tickets ▸ implement ▸ review   │
╰───────────────────────────────────────────────╯
╭───────────────────────────────────────────────╮
│ ◆ agents                      ■ ■ □ 2/3 slots │
│ 1: implementer ● #241 · Implement #241   ↻ 3m │
│  Bash mise run lint                           │
│ 2: merger #239 ✓ · Merged cleanly         12m │
╰───────────────────────────────────────────────╯
╭───────────────────────────────────────────────╮
│ ◆ tickets                         2 of 5 done │
│ ████████████████▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░ │
│ ■ done 2  ■ in progress 1  ■ ready 1  ■ …     │
│                                               │
│ ■ #238 reopen an acknowledged warning  merged │
│ ■ #241 Create episode opens…      implementer │
│ ■ #240 a row preview replaces…     after #239 │
╰───────────────────────────────────────────────╯
```

### What it shows

- **flow**: the spec being followed, its integration PR with its CI state, and the stage. A skill that runs sets the stage; a spec followed with `/skillmaps spec <n>` takes it from its tickets and PR.
- **agents**: each subagent this session spawns, with its role (implementer, merger, reviewer, explorer, read from its description), the tickets it names, the tool it is running now and how long it has run. The slot meter counts running implementers against a cap: the `slots` setting, or else the cap the running implement skill states ("in **3 slots** at most"). With neither, it counts them with no cap.
- **steps**: press an agent's digit (`1`–`9`) and its card lays out what it did, newest last: each tool it ran with how long it took, ✗ and the error's first line where one failed, and the lines it wrote between tools (`› The lint passes; now the tests.`). `o` puts that agent's whole transcript in the main view, as the tasks list does, and back; `x` closes the card.
- **tickets**: the spec's sub-issues as one bar split by state, a legend, and one row per ticket: closed, merged into the integration branch, being merged, implemented and waiting for a merge, in progress, ready (on the frontier), or blocked by the tickets it waits for.

### Requirements

- The [GitHub CLI](https://cli.github.com), signed in, run from a checkout of the repository whose issues hold the spec.
- Specs and tickets laid out the way `/to-spec` and `/to-tickets` publish them: tickets are sub-issues of the spec, their blockers either a `## Blocked by` section or GitHub's native blocking links.

### Use

| Command | What it does |
| --- | --- |
| `/skillmaps spec` | Opens the pane. |
| `/skillmaps spec <n>` | Follows spec issue `#n` and loads its tickets. |
| `/skillmaps spec refresh` | Reads the spec, its tickets and its PR from GitHub again. |
| `/skillmaps spec clear` | Forgets the spec, the agents and the stage. |

Its one setting, `spec-map implementer slots`, is listed under [Settings](#settings).

In the pane, `r` refreshes, `c` clears, a digit focuses an agent's steps, `o` opens its transcript and `x` closes them. The pane opens by itself when a flow skill runs, as a sidebar from 144 terminal columns; below that, open it with `/skillmaps spec`. It also refreshes every minute and whenever an implementer or a merger finishes.

The spec is picked up without a command too: from the argument of `/implement-spec` or `/to-tickets`, or from the issue `/to-spec` creates.

### How it knows

| It shows | It reads |
| --- | --- |
| stage | the skills that run (`skill.prompt`, the Skill tool, a typed `/skill`), else the tickets and the PR |
| agents | `agent.spawn`, each subagent's `tool.call`, and its `turn.complete` |
| steps | each subagent's `tool.call` and its result, and the text of its `turn.step`s |
| tickets | `gh api …/issues/<spec>/sub_issues`, and `…/dependencies/blocked_by` where the body names no blockers |
| merged | the merge commits of the spec's PR that name a ticket (`Merge #239: …`, `feat: merge … (#238)`) |
| PR and CI | the PR whose title or body names `#<spec>`, and its `statusCheckRollup` |

### Limits

- A mod sees the subagents of its own session only. Run `/implement-spec` in the session that shows the pane, or the agents card and the slot meter stay empty; ticket progress still shows, since it comes from GitHub.
- An agent's role and tickets are read from its Agent call: name the role and the `#ticket` in the description.

## Develop

From this folder:

```sh
claude plugin validate .
claude plugin test .
```

The engine follows `$` only into functions declared at the top of the hooks module, and takes one hook per event without a matcher, so the three maps share `hooks/register.tsx`. Each map's names carry its prefix where two would clash (`grillCurrent`, `WAY_PANE`, `specRefresh`); its hooks are registered by `registerGrill`, `registerWay` or `registerSpec`, and the events two maps share are chained once in `register`, each map in turn while its setting is on. What draws without `$` sits beside it: `header.tsx`, `spine.tsx`, `reply.ts`, `graph.tsx`.

Claude Code writes the API's types into `.claude-plugin/types/` when it loads the mod, and `tsconfig.json` extends them, so `tsc -p .` type-checks it after the first load.

## License

MIT, see the [repository's license](../../LICENSE).
