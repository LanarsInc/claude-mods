# usage-pace

A Claude Code mod that shows your plan's usage limits just above the prompt and tells you how much
you can use today and still have some left by the end of the week.

```
Session ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━     16% · resets in 4h     ×
Week     Thu   Fri   Sat   Sun   Mon ▸ Tue   Wed    45% · today 13.6% left 7d 5d
```

(In the terminal the used part of the bars is green, and today is bold, with a blue `▸` before it.
Of `7d` and `5d`, the one in use is lit green.)

- **Session** is the 5-hour window: how much of it is used and when it resets.
- **Week** is the weekly limit's own week: its seven days from one reset to the next, so it starts
  on whatever day your limit resets. Each day's share is a seventh of the
  limit; paced over workdays it is a fifth on a workday, and Saturday and Sunday stay on the bar in
  gray, crossed out, with no share. What the week has used fills the days in order from the first,
  so a day you didn't use is filled first by the days after it. Days the use has run ahead into
  turn amber.
- **today … left** is what you can still use today and stay on pace: the shares from the reset up to
  today, less what was used. It turns amber, saying "over", once you are ahead of pace.
- **7d / 5d** switches how the week is paced: over all 7 days, or over the 5 workdays. Click the one
  you want; the choice stays in new sessions.
- The band is two lines. As the terminal gets narrower it words itself shorter, then drops the
  switch, and then the bars.

It needs a Pro or Max plan: Claude Code gets the usage figures with each reply.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install usage-pace --marketplace LanarsInc/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (Enter takes the first, your user account).
The band appears above the prompt after the next reply.

From a shell:

```
claude plugin install usage-pace --marketplace LanarsInc/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins,
Add marketplace with `LanarsInc/claude-mods`, then Add plugin.

To try it for one session without installing it, clone this repository and run
`claude --plugin-dir <the clone>/plugins/usage-pace`.

To remove it: `claude plugin uninstall usage-pace@lanars`.

Built and tested with Claude Code 2.1.322.

## Commands

| Command | What it does |
|---|---|
| `/usage-pace` | Shows the band (it stays on in new sessions) |
| `/usage-pace hide` | Hides the band until you run `/usage-pace` again |
| `/usage-pace week` | Paces the weekly limit over all 7 days (the default) |
| `/usage-pace workdays` | Paces it over the 5 workdays; the weekend gets no share |
| `/usage-pace full` | Opens a detailed pane: the reset time, the budgets so far, an Update now button |

The `[-]` beside the band (or ctrl+x ctrl+a) folds it away without hiding it.

## How it counts

Each reply brings the usage figures. The mod notes, for each day, where the weekly figure started
and the most it reached, so it knows what each day used. All your sessions share these notes.

Days before the mod was installed have no notes. For the part of the current week before that, the mod
estimates once how the weekly figure was spread over the days, by weighing the replies in your Claude
Code transcripts (`tools/weigh.py`, run with `python3`). Those days show with a `~`. The script reads
the transcripts on your computer only; nothing is sent anywhere. Without `python3` those days stay blank.

Usage on claude.ai or the Claude apps also counts toward the limits, but Claude Code only sees it with
its next reply, so it lands on the day of that reply.

## Development

`claude plugin test .` runs the tests, and `claude plugin validate .` checks the mod.
