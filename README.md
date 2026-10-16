# modsbook

A book of Claude Code mods: side panes, bands, status lines and hooks, each one line to install.

Mods are plugins of function hooks for [Claude Code](https://docs.claude.com/en/docs/claude-code) that run inside a session, in the terminal and in the desktop app's Code tab. This repository is a plugin marketplace, `modsbook`, with one plugin per mod.

## Mods

| Mod | What it does |
| --- | --- |
| [skillmaps](mods/skillmaps) | Three side panes along the [AI Hero skills](https://www.aihero.dev/skills), each turned on in the settings: grill-map draws a grilling's design tree, wayfinder-map a `/wayfinder` map up to the spec, spec-map a spec from its tickets to the merge. |

grill-map, wayfinder-map and spec-map were three mods before: they are skillmaps' three maps now. Coming from them, see [its install notes](mods/skillmaps#coming-from-grill-map-wayfinder-map-or-spec-map).

Here is skillmaps in a Claude Code session: grill-map docked beside the transcript, following a `/grill-with-docs` with its next round waiting for your answer.

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

## Install

At the prompt of a Claude Code terminal session, add the marketplace first (once):

```text
/plugin marketplace add bardaxx/modsbook
```

Then install a mod by name, and pick a scope (Enter takes the user scope). A mod with settings shows them next. The mod runs in that session at once, and in every session after:

```text
/plugin install skillmaps@modsbook
```

## Update

A mod updates when you ask for it:

```sh
claude plugin update <mod>@modsbook
```

The new version loads in the next session, or at once with `/reload-plugins`.

To have updates arrive on their own, turn on auto-update for modsbook in `/plugin`, under Marketplaces. It is off by default, as for every marketplace outside Anthropic's own. Each session then checks modsbook as it starts, and `Plugin updated: <mod> · Run /reload-plugins to apply` says when a new version is in.

A new version is one whose `version` in `plugin.json` has gone up: changing a mod means raising it, or nobody receives the change.

## Layout

```text
.claude-plugin/marketplace.json   the marketplace: one entry per mod
mods/<mod>/
  .claude-plugin/plugin.json      the mod's manifest
  hooks/hooks.json                names the hooks module
  hooks/register.tsx              the hooks module
  types/index.d.ts                its $.state contract, when it keeps state
  tests/*.test.ts(x)              run by `claude plugin test`
  README.md                       what it does and how to use it
scripts/check.sh                  validates and tests every mod, and checks its version went up
```

## Adding a mod

1. Make the mod in `mods/<mod>/`, laid out as above. A mod written in a Claude Code session (its mods folder) is copied here without `.claude-plugin/types/`, which Claude Code writes at each load.
2. Add its entry to `.claude-plugin/marketplace.json`: `name` as in its `plugin.json`, `source` `./mods/<mod>`, and a one-line `description`.
3. Add its row to the table above.
4. Run `scripts/check.sh`. It fails when a mod changed since the branch's upstream (or `BASE=<ref>`) without raising `version` in its `plugin.json`; README and tests changes need no raise.

To try a mod from a clone without installing it:

```sh
claude --plugin-dir mods/<mod>
```

## License

MIT
