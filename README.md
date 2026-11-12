# Claude Code mods from LANARS

Mods for [Claude Code](https://claude.com/claude-code): small plugins that change its interface.

| Mod | What it does |
|---|---|
| [usage-pace](plugins/usage-pace) | Shows your plan's session and weekly usage above the prompt, with a daily budget that lasts the week |
| [tree](plugins/tree) | A file tree pane beside the transcript: git status per file, a preview, and the files Claude changes light up as it works |

## Install

At the prompt of a Claude Code terminal session, install the ones you want:

```
/plugin install usage-pace --marketplace LanarsInc/claude-mods
/plugin install tree --marketplace LanarsInc/claude-mods
```

The first time, answer `y` to add the marketplace. Then pick a scope (Enter takes the first, your user
account).

From a shell:

```
claude plugin install usage-pace --marketplace LanarsInc/claude-mods
claude plugin install tree --marketplace LanarsInc/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `LanarsInc/claude-mods`, then Add plugin.

Each mod's own README says what it shows and how to use it.

## Update

```
claude plugin marketplace update lanars
claude plugin update usage-pace@lanars
claude plugin update tree@lanars
```

Then restart Claude Code.

## License

MIT. See [LICENSE](LICENSE).
