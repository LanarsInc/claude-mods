// The values the mod keeps in $.state (they survive a hot reload; module variables do not).

export type Entry = {
  name: string
  kind: 'file' | 'dir' | 'other'
  isLink: boolean
}

export type Git = {
  // The repository's root, '' outside a repo.
  top: string
  branch: string
  upstream: string
  ahead: number
  behind: number
  // Absolute path -> porcelain XY code (' M', 'A ', '??', ...). An untracked folder is listed once, as itself.
  status: Record<string, string>
  // Absolute path -> [added, deleted] lines against HEAD.
  lines: Record<string, [number, number]>
}

// A file Claude just changed, lit until this time (ms).
export type Flash = {
  until: number
}

// The preview under the tree, of the file under the cursor.
export type Preview = {
  // False once the person hid it (`p`).
  on: boolean
  // The file the scroll and mode belong to; any other file starts at its top, in its default mode.
  path: string
  // The first line shown.
  scroll: number
  // What the person switched to with `d`; '' is the default: the changes, for a file git marks changed.
  mode: '' | 'diff' | 'file'
  // The line of the file where Claude's last change to it starts, which the window opens on until the person
  // scrolls; 0 for none.
  line: number
}

export type TreeState = {
  // The folder the session started in, which the person trusted: git runs only inside it.
  workspace: string
  root: string
  // True when /tree was given a path; false follows the session's cwd.
  pinned: boolean
  // Loaded listings, sorted, by absolute folder path.
  dirs: Record<string, Entry[]>
  expanded: string[]
  cursor: string
  selected: string
  // First visible row, and the path the next draw must keep in view ('' for none).
  scroll: number
  focus: string
  git: Git
  flashes: Record<string, Flash>
  // Files Claude changed, each with a dot until git shows it clean (an ignored file keeps it).
  edited: string[]
  // Of those, the ones git has shown changed since: one git then shows clean loses its dot, even when git no
  // longer tracks it (deleted, or newly ignored).
  shownChanged: string[]
  // The file Claude's last Read, Edit, Write or NotebookEdit call names, marked from the moment the call starts
  // until the turn ends; '' for none, and for a file outside the tree.
  working: string
  // The search field's text, and the files matching it (absolute paths, best first); '' shows the tree.
  query: string
  results: string[]
  preview: Preview
}

declare module 'claude-code' {
  interface PluginState {
    tree: {
      tree: TreeState
    }
  }
}
