# modsbook

A book of Claude Code mods: side panes, bands, status lines and hooks, each one line to install.

Mods are plugins of function hooks for [Claude Code](https://docs.claude.com/en/docs/claude-code) that run inside a session, in the terminal and in the desktop app's Code tab. This repository is a plugin marketplace, `modsbook`, with one plugin per mod.

## Mods

| Mod | What it does |
| --- | --- |
| [spec-flow](mods/spec-flow) | A side pane that follows a spec from idea to merge: the stage, what each subagent is doing, the tickets and the integration PR. |
| [wayfinder-map](mods/wayfinder-map) | A side pane for `/wayfinder`: the map's route as a tree of decision tickets, the decisions so far, the fog, and each grilling round as a design tree. |

## Install

At the prompt of a Claude Code terminal session, name the mod:

```text
/plugin install spec-flow --marketplace bardaxx/modsbook
```

Answer `y` to add the marketplace (once), then pick a scope (Enter takes the user scope). The mod runs in that session at once, and in every session after.

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
