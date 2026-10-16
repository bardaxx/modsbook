# modsbook

A book of Claude Code mods: side panes, bands, status lines and hooks, each one line to install.

Mods are plugins of function hooks for [Claude Code](https://docs.claude.com/en/docs/claude-code) that run inside a session, in the terminal and in the desktop app's Code tab. This repository is a plugin marketplace, `modsbook`, with one plugin per mod.

## Mods

| Mod | What it does |
| --- | --- |
| [spec-flow](mods/spec-flow) | A side pane that follows a spec from idea to merge: the stage, what each subagent is doing, the tickets and the integration PR. |

## Install

At the prompt of a Claude Code terminal session, name the mod:

```text
/plugin install spec-flow --marketplace bardaxx/modsbook
```

Answer `y` to add the marketplace (once), then pick a scope (Enter takes the user scope). The mod runs in that session at once, and in every session after.

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
scripts/check.sh                  validates and tests every mod
```

## Adding a mod

1. Make the mod in `mods/<mod>/`, laid out as above. A mod written in a Claude Code session (its mods folder) is copied here without `.claude-plugin/types/`, which Claude Code writes at each load.
2. Add its entry to `.claude-plugin/marketplace.json`: `name` as in its `plugin.json`, `source` `./mods/<mod>`, and a one-line `description`.
3. Add its row to the table above.
4. Run `scripts/check.sh`.

To try a mod from a clone without installing it:

```sh
claude --plugin-dir mods/<mod>
```

## License

MIT
