# grill-map

A Claude Code mod that docks a side pane beside the transcript and draws a grilling session as a map of its choices, read top to bottom: [`/grill-me`](https://www.aihero.dev/skills-grill-me), [`/grill-with-docs`](https://www.aihero.dev/skills-grill-with-docs), or [`/grilling`](https://www.aihero.dev/skills-grilling) itself. Each round is one level of the design tree on a vertical spine, its questions hanging from it with the recommendation and what was chosen, and between the levels the facts the agent looked up and the docs it wrote.

```text
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

## What it shows

- **header**: the skill that started the grill, its subject, the questions settled out of those asked, and one bar split by how each stands: `✓` took the recommendation, `✎` answered otherwise, `⏎` answered in a reply that was not split by number, `◌` still open. Beside it, the lookups, the glossary terms (`≡`) and the ADRs (`⚑`) of the grill.
- **Spine**: the design tree, top to bottom, drawn as [wayfinder-map](../wayfinder-map) draws each ticket's, from the same file.
  - Each round is a level, `L1`, `L2`, …: the frontier as it stood, every question whose prerequisites were settled. The newest level is drawn whole: each question's body, the choices it offered, the recommendation (`➡`, `✓` when the person said yes) and what the person answered instead (`✎`). An older level folds to one line per decision, `title → what was chosen`; a click or a tap on its heading unfolds it. Once the grill is confirmed, every level folds. Each new level takes the focus: when it arrives every level before it folds, one unfolded by hand too.
  - An AskUserQuestion dialog asked during the grill is a level too, the option picked marked `●`.
  - `⌕` marks a fact the agent went to find instead of asking: a sub-agent, running until it reports, or a run of reads and searches folded into one line.
  - `≡` marks the terms written to `CONTEXT.md` or `GLOSSARY.md`, and `⚑` each ADR written under `docs/adr/` (`/grill-with-docs`, through `domain-modeling`).
  - `◎ wrap-up` is the turn that ends without questions once the rounds are answered: the frontier is empty and the summary waits for the person's word. A yes closes the grill, `◉ shared understanding confirmed`; a yes with a reserve (`sì, ma …`, `yes, but …`) or anything else pushes it back, and the next wrap-up is put to the person again.
  - `▼` says where the tree goes next: the questions still open, a lookup running, or the next frontier being worked out.
- **status line**: while a grill is open, its level and what waits on the person, `grill L2 · 2 open`, or `grill · confirm the shared understanding` at the wrap-up. It goes once the grill is confirmed or cleared.

A session can hold several grills: each new `/grill-me` or `/grill-with-docs` starts one, and `p` / `n` page through them.

### Inside `/wayfinder`

With [wayfinder-map](../wayfinder-map) installed too, a `/wayfinder` Run is wayfinder-map's: grill-map reads it and follows it.

- Its status line goes, and wayfinder-map's carries the ticket being worked.
- It opens one grill per claimed ticket, named after the ticket, and a `charting` grill for the rounds asked with no ticket claimed.
- The Run ends on `/clear`, on a `/grill-me` or `/grill-with-docs` you ask for, or on `/waymap clear`; grill-map then holds grills of its own again.

Without wayfinder-map, a `/wayfinder` grill is a grill like any other.

## Requirements

- Claude Code with function-hook mods (2.1.292 or later).
- The grilling skills from [mattpocock/skills](https://github.com/mattpocock/skills): `grilling`, and the `grill-me` or `grill-with-docs` wrapper (`grill-with-docs` also needs `domain-modeling`).

## Install

At the prompt of a Claude Code terminal session, add the marketplace (once), then install the mod:

```text
/plugin marketplace add bardaxx/modsbook
/plugin install grill-map@modsbook
```

Pick a scope when asked (Enter takes the user scope).

To update it:

```sh
claude plugin update grill-map@modsbook
```

To run it from a clone while you change it:

```sh
claude --plugin-dir /path/to/modsbook/mods/grill-map
```

## Use

No command is needed: the pane opens when `/grill-me`, `/grill-with-docs` or `/grilling` runs, or when an answer holds a round in the grilling format.

| Command | What it does |
| --- | --- |
| `/grillmap` | Opens the pane. |
| `/grillmap clear` | Forgets the grills of this session. |

In the pane, a click or a tap on a level's heading folds or unfolds it, `a` (or the `Unfold` / `Fold` button) unfolds every level or folds them back, `p` and `n` show the previous and next grill, and `c` clears.

## How it knows

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

## Limits

- A reply that answers a round in prose, without numbering, is kept whole under the level rather than split across its questions.
- A reply is read as a yes when it opens with one (`yes`, `ok`, `sì`, `lgtm`, …) and no reserve follows. The grilling skill words each question so that yes takes its recommendation; a question worded against its recommendation is read the same way.
- A yes with a reserve said whole to a round of several questions stays unsplit (`⏎`): the reserve cannot be pinned to one question.
- A level is the round as the agent asked it: when the agent puts dependent questions in the same round, they sit on the same level.
- The wrap-up is read from the shape of the turn. An answer that ends without questions for another reason, such as a pause to look something up, shows as a wrap-up until the next round arrives.
- Grills are kept for the session, not across sessions.

## Develop

From this folder:

```sh
claude plugin validate .
claude plugin test .
```

Claude Code writes the API's types into `.claude-plugin/types/` when it loads the mod, and `tsconfig.json` extends them, so `tsc -p .` type-checks it after the first load.

## License

MIT, see the [repository's license](../../LICENSE).
