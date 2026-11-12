// Pure helpers: paths, the rows a tree shows, and git's output. Nothing here touches `$`.

import type { Entry, Git, TreeState } from '../types'

// Never listed.
export const HIDE = new Set(['.git', '.DS_Store'])

export const EMPTY_GIT: Git = { top: '', branch: '', upstream: '', ahead: 0, behind: 0, status: {}, lines: {} }

export const EMPTY: TreeState = {
  workspace: '',
  root: '',
  pinned: false,
  dirs: {},
  expanded: [],
  cursor: '',
  selected: '',
  scroll: 0,
  focus: '',
  git: EMPTY_GIT,
  flashes: {},
  edited: [],
  shownChanged: [],
  working: '',
  query: '',
  results: [],
  preview: { on: true, path: '', scroll: 0, mode: '', line: 0 },
}

// --- paths (POSIX) ---

export function normalize(path: string, base: string, home = ''): string {
  const expanded = home && (path === '~' || path.startsWith('~/')) ? home + path.slice(1) : path
  const raw = expanded.startsWith('/') ? expanded : `${base}/${expanded}`
  const parts: string[] = []
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
}

export const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/'

export const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1) || path

export const join = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)

export const inside = (root: string, path: string): boolean =>
  path === root || path.startsWith(root === '/' ? '/' : `${root}/`)

export function relativeTo(root: string, path: string): string {
  if (path === root) return '.'
  return inside(root, path) ? path.slice(root === '/' ? 1 : root.length + 1) : path
}

// The folders between root and path: root's child first, path's parent last.
export function ancestors(root: string, path: string): string[] {
  const out: string[] = []
  for (let dir = parentOf(path); dir !== root && inside(root, dir); dir = parentOf(dir)) out.unshift(dir)
  return out
}

// --- the tree ---

export function sortEntries(list: readonly Entry[]): Entry[] {
  return list
    .filter(entry => !HIDE.has(entry.name))
    .sort(
      (a, b) =>
        (a.kind === 'dir' ? 0 : 1) - (b.kind === 'dir' ? 0 : 1) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
    )
}

export type Visible = { path: string; depth: number; entry: Entry }

// Every row the tree shows, top to bottom: loaded folders' entries, open folders' children under them.
export function visible(t: TreeState): Visible[] {
  const out: Visible[] = []
  const open = new Set(t.expanded)
  const walk = (dir: string, depth: number) => {
    for (const entry of t.dirs[dir] ?? []) {
      const path = join(dir, entry.name)
      out.push({ path, depth, entry })
      if (entry.kind === 'dir' && open.has(path)) walk(path, depth + 1)
    }
  }
  if (t.root) walk(t.root, 0)
  return out
}

// Files matching every word of the query somewhere in their path under root, case-insensitive. Best first:
// all words in the file name, then the name starting with the first word, then the shorter path.
export function search(files: readonly string[], root: string, query: string, limit = 200): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const first = words[0]
  if (!first) return []
  const hits: { path: string; score: number }[] = []
  for (const path of files) {
    const rel = relativeTo(root, path).toLowerCase()
    if (!words.every(w => rel.includes(w))) continue
    const name = nameOf(rel)
    const score = (words.every(w => name.includes(w)) ? 0 : 10_000) + (name.startsWith(first) ? 0 : 1_000) + rel.length
    hits.push({ path, score })
  }
  return hits
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(hit => hit.path)
}

// --- git ---

// `git status --porcelain=v1 -z -b`: a `## branch...upstream [ahead 1, behind 2]` header, then `XY path`
// entries; a rename or copy is followed by its source path. Paths are relative to the repository root.
export function parseStatus(out: string, top: string): Omit<Git, 'top' | 'lines'> {
  const parts = out.split('\0')
  const git: Omit<Git, 'top' | 'lines'> = { branch: '', upstream: '', ahead: 0, behind: 0, status: {} }
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    if (!part) continue
    if (part.startsWith('## ')) {
      const head = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(part.slice(3))
      git.branch = head?.[1] ?? part.slice(3)
      git.upstream = head?.[2] ?? ''
      git.ahead = Number(/ahead (\d+)/.exec(head?.[3] ?? '')?.[1] ?? 0)
      git.behind = Number(/behind (\d+)/.exec(head?.[3] ?? '')?.[1] ?? 0)
      continue
    }
    const code = part.slice(0, 2)
    git.status[join(top, part.slice(3).replace(/\/$/, ''))] = code
    if (code[0] === 'R' || code[0] === 'C') i++
  }
  return git
}

// `git diff --numstat -z`: `added\tdeleted\tpath`, or for a rename `added\tdeleted\t` then old and new paths.
// Binary files count as `-`, read here as 0.
export function parseNumstat(out: string, top: string): Record<string, [number, number]> {
  const lines: Record<string, [number, number]> = {}
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const row = /^(\d+|-)\t(\d+|-)\t(.*)$/.exec(parts[i] ?? '')
    if (!row) continue
    let rel = row[3] ?? ''
    if (!rel) {
      i += 2
      rel = parts[i] ?? ''
    }
    if (rel) lines[join(top, rel)] = [Number(row[1]) || 0, Number(row[2]) || 0]
  }
  return lines
}

export type Tone = '' | 'untracked' | 'added' | 'renamed' | 'deleted' | 'modified' | 'conflict'

const RANK: Record<Tone, number> = { '': 0, untracked: 1, added: 2, renamed: 3, deleted: 4, modified: 5, conflict: 6 }

export function toneOf(code: string): Tone {
  if (!code) return ''
  if (code === '??') return 'untracked'
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflict'
  if (code.includes('D')) return 'deleted'
  if (code[0] === 'R' || code[0] === 'C') return 'renamed'
  if (code.includes('A') && !code.includes('M')) return 'added'
  return 'modified'
}

// The letter shown after a file, as editors show it.
export const LETTER: Record<Tone, string> = {
  '': '',
  untracked: 'U',
  added: 'A',
  renamed: 'R',
  deleted: 'D',
  modified: 'M',
  conflict: '!',
}

// A file's tone: its own entry, or the untracked folder it sits in.
export function fileTone(git: Git, path: string): Tone {
  const own = git.status[path]
  if (own) return toneOf(own)
  if (!git.top) return ''
  for (let dir = parentOf(path); inside(git.top, dir); dir = parentOf(dir)) {
    if (git.status[dir] === '??') return 'untracked'
    if (dir === git.top) break
  }
  return ''
}

// Claude's dots after a git run that looked under `root`: a file git shows changed is remembered, and one it
// shows clean loses its dot when git showed it changed before or tracks it (`tracked`). A file git ignores
// keeps it. One outside `root`, where git looked at nothing, or in `newer`, changed again after the run
// began, is not judged.
export function settleEdited(
  edited: readonly string[],
  shown: readonly string[],
  git: Git,
  root: string,
  tracked: ReadonlySet<string>,
  newer: ReadonlySet<string>,
): Pick<TreeState, 'edited' | 'shownChanged'> {
  const was = new Set(shown)
  const shownChanged: string[] = []
  const kept = edited.filter(path => {
    const judged = git.top && inside(root, path) && !newer.has(path)
    const changed = judged ? fileTone(git, path) !== '' : was.has(path)
    if (changed) shownChanged.push(path)
    return changed || !judged || (!was.has(path) && !tracked.has(path))
  })
  return { edited: kept, shownChanged }
}

// Each folder holding a change, with the strongest tone under it.
export function folderTones(git: Git): Map<string, Tone> {
  const out = new Map<string, Tone>()
  if (!git.top) return out
  for (const [path, code] of Object.entries(git.status)) {
    const tone = toneOf(code)
    for (let dir = path; inside(git.top, dir); dir = parentOf(dir)) {
      if (RANK[tone] > RANK[out.get(dir) ?? '']) out.set(dir, tone)
      if (dir === git.top) break
    }
  }
  return out
}
