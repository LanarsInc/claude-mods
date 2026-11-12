# tree

Our own file tree for Claude Code, written from scratch as a mod (a plugin of function hooks). It docks
beside the transcript and shows:

- the session's folder, folders first, `.git` and `.DS_Store` left out, dotfiles dim, and control characters
  in a name (escape sequences, bidi overrides) shown as `?`, here and in toasts
- git status per file (`M` modified, `U` untracked, `A` added, `D` deleted, `R` renamed, `!` conflict) with
  `+N -N` lines changed, a dot on folders holding changes, and the branch with `↑ahead ↓behind` in the header.
  A repository's own config can make git run programs, so git runs only in the repository the session
  started in, never in one nested inside it (a downloaded folder or a dependency with its own `.git`, or a
  folder laid out as a repository without one), and with `core.fsmonitor`, external diff, textconv and
  signature checks off. Filters set in your own
  repository's config still run, as they do for any git command there
- the files Claude changes: they light up orange for 2.5 s, their folders open, the tree scrolls to them and
  the cursor moves to the first, so the preview shows its changes, opened where an Edit or Write starts (not
  while you search). Files Claude changed keep an orange `•` until git shows them clean (a commit, a checkout, a revert); a file git
  ignores keeps it for the session. A change is a file the Edit, Write or NotebookEdit
  tool names, or one a Bash command's result lists as changed (the list Claude Code passes back with it). A
  command whose result lists nothing lights up nothing, though the tree lists its folders again after every
  command. Reads never light up, and neither do `node_modules` and `.git`
- the file Claude is on: the one its Read, Edit, Write or NotebookEdit call names gets a cyan `❯` and a cyan
  name from the moment the call starts (a permission prompt included) until Claude's next file or the end of
  the turn. For an Edit, Write or NotebookEdit its folders open and the tree scrolls to it as the call starts
  (the cursor and the preview move once the change is made); a read moves nothing, so a file in a closed
  folder is marked unseen. A file outside the tree takes the mark off
- a search field under the header: it finds any file under the tree, open folder or not, matching every word
  you type somewhere in the path (file names first, then shorter paths). Inside a repository the list is git's
  (tracked and untracked, ignored files and `node_modules` left out), elsewhere a walk of the folder
- a preview under the tree of the file under the cursor: source with syntax colours and line numbers, a
  changed file's `git diff HEAD` changes (`d` switches to the whole file), both with long lines wrapped onto
  the rows below, Markdown rendered, and PNG pictures in the terminal. Folders, binary files, files over 2 MB and files that usually hold secrets (`.env`, private
  keys) get a one-line note instead, and in a previewed Markdown file only links to the web and to mail
  stay links: `file:` and any other scheme draw as plain text. It
  needs 12 free rows in the pane; the tree keeps about 45% of them
- the selected file, which goes to Claude with your next prompt as context ("what changed in it?")

It needs Claude Code 2.1.287 or newer and the fullscreen layout (`/tui fullscreen`); below 110 columns the
pane sits above the prompt instead of beside the transcript.

## Using it

| Do | What happens |
| --- | --- |
| `/tree` | opens the pane on the cwd and follows it |
| `/tree <path>` | pins the pane to that folder |
| click a folder | opens or closes it |
| click a file | selects it (click again to unselect); a double click opens it in its default app, or shows it in Finder when it could run as a program (a script, a launcher, anything executable) |
| wheel | scrolls the tree, or the preview when the pointer is over it |
| after a click: arrows or `hjkl` | move; right opens, left closes or goes to the parent |
| a screenshot dragged into the terminal, or a paste, after a click | the prompt takes the keys back: what you type next goes there |
| Enter / Space | opens a folder, selects a file |
| `o` / `y` | opens the file / copies its path |
| `/` (after a click in the tree), or a click on the search field | type to list matching files |
| Enter in the search field, or a click on a match | shows the file in the tree, selected, and clears the search |
| `×` | clears the search |
| `p` | hides or shows the preview |
| `d` | in the preview of a changed file, switches between its changes and the whole file |
| `J` / `K`, or ▲ / ▼ | scroll the preview by half its height |

The one setting lives in `/config` under tree: **Follow Claude** (`on` opens folders, scrolls to the files
Claude changes and previews the first; `off` leaves the tree and the cursor alone).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install tree --marketplace LanarsInc/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (Enter takes the first, your user account). `/tree`
opens the pane.

From a shell:

```
claude plugin install tree --marketplace LanarsInc/claude-mods
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add
marketplace with `LanarsInc/claude-mods`, then Add plugin.

To remove it: `claude plugin uninstall tree@lanars`.

## Developing it

Clone this repository and load the mod from its folder: `claude --plugin-dir <the clone>/plugins/tree` for
one session, or list that folder in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` to load it in
every session. An edit to any file then reloads it when the turn that made it ends; a new value for that
variable needs a restarted session.

## Files

| File | What it holds |
| --- | --- |
| `.claude-plugin/plugin.json` | name, version, the `/config` option |
| `hooks/register.tsx` | the hooks: session start, `/tree`, tool calls (Bash included), prompts, git watching, search, the preview, the pane's drawing, clicks and keys |
| `hooks/preview.ts` | pure helpers for the preview: windows of source, Markdown and diffs, how many wrapped lines fit, PNG sizes, which files it skips |
| `hooks/rows.tsx` | the rows, drawn on the surface itself (hover, clicks and keys are posted back to the hooks) |
| `hooks/model.ts` | pure helpers: paths, the visible rows, search ranking, git `status` and `numstat` parsing |
| `types/index.d.ts` | the state the pane draws from (`$.state`, kept across hot reloads) |
| `tests/pane.test.ts` | the tests, on the terminal and the desktop app, with disk, git and clock mocked |

## Checks

```bash
claude plugin validate .
claude plugin test .
```

Type-checking needs TypeScript 5.4+; once a session has loaded the mod, `.claude-plugin/types/` holds the
API declarations and `npx -p typescript tsc -p .` uses them through the tsconfig the engine writes.

## Ideas for later

- `@path` in a prompt reveals that file
- a size or date column
