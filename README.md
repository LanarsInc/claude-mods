# Claude Code mods from LANARS

Mods for [Claude Code](https://claude.com/claude-code): small plugins that change its interface.

| Mod | What it does |
|---|---|
| [usage-pace](plugins/usage-pace) | Shows your plan's session and weekly usage above the prompt, with a daily budget that lasts the week |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-pace --marketplace LanarsInc/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (Enter takes the first, your user account).

From a shell:

```
claude plugin install usage-pace --marketplace LanarsInc/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `LanarsInc/claude-mods`, then Add plugin.

Each mod's own README says what it shows and how to use it.

## Update

```
claude plugin marketplace update lanars
claude plugin update usage-pace@lanars
```

Then restart Claude Code.

## License

MIT. See [LICENSE](LICENSE).
