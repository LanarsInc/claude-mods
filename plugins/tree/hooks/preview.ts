// What the preview under the tree shows of a file: its lines cut to the window, Markdown that still draws when
// the window starts inside a code block, a diff's hunks cut so they still parse, a PNG's size. Pure helpers;
// nothing here touches `$`.

export type Hunk = { oldStart: number; newStart: number; lines: string[] }

// Code and Markdown hold at most 10000 characters; the windows stay under this.
const BUDGET = 9000

export const isPicture = (path: string): boolean => /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|heic|avif)$/i.test(path)
export const isMarkdown = (path: string): boolean => /\.(md|markdown|mdx)$/i.test(path)
// Files that usually hold secrets: not drawn just because the cursor passed over them.
export const isSecret = (path: string): boolean =>
  /(^|\/)(\.env(\.[^/]*)?|\.netrc|\.npmrc|\.pypirc|id_(rsa|dsa|ecdsa|ed25519)|credentials(\.json)?)$|\.(pem|key|p12|pfx|jks|keystore)$/i.test(path)

// Text that is not text: a NUL, or many replacement characters (bytes that were not UTF-8).
export function looksBinary(text: string): boolean {
  const head = text.slice(0, 8000)
  if (head.includes('\0')) return true
  const bad = head.split('�').length - 1
  return bad > 8 && bad > head.length / 100
}

// A file's lines, without the empty one after a final newline.
export function linesOf(text: string): string[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

// One line as Code and Markdown may hold it: tab is the only control character kept; the others, format
// characters (bidi overrides could reorder what is drawn) and line separators show as `?`.
export function cleanLine(line: string, max = 300): string {
  const text = line.replace(/\r$/, '').replace(/[\p{Cf}\p{Zl}\p{Zp}]|(?!\t)\p{Cc}/gu, '?')
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// The longest line a window of this many rows keeps, so the whole stays under the budget.
const widest = (rows: number): number => Math.max(40, Math.min(300, Math.floor(BUDGET / Math.max(1, rows))))

// The cells a line takes on screen, as far as an estimate goes: a tab as 4, and no more than a window keeps.
const cellsOf = (line: string): number => Math.min(300, line.length + 3 * (line.split('\t').length - 1))

const rowsOf = (line: string, columns: number): number => Math.max(1, Math.ceil(cellsOf(line) / Math.max(1, columns)))

// The columns Code leaves its text beside a gutter of `digits`-wide line numbers (a diff's has two, and a
// marker): an estimate on the safe side, so a window ends a row early rather than losing a line under its edge.
export const textColumns = (columns: number, digits: number, diff: boolean): number =>
  Math.max(10, columns - (diff ? 2 * digits + 5 : digits + 3))

// How many lines from `scroll` on fit in `height` rows once long ones wrap at `columns`; at least one.
export function fitLines(lines: readonly string[], scroll: number, height: number, columns: number): number {
  let rows = 0
  let count = 0
  for (let i = scroll; i < lines.length; i++) {
    rows += rowsOf(lines[i] ?? '', columns)
    if (rows > height) break
    count++
  }
  return Math.max(1, count)
}

// The last line a window of `height` rows can start at and still show the end.
export function lastStart(lines: readonly string[], height: number, columns: number): number {
  let rows = 0
  for (let i = lines.length - 1; i >= 0; i--) {
    rows += rowsOf(lines[i] ?? '', columns)
    if (rows > height) return Math.min(lines.length - 1, i + 1)
  }
  return 0
}

export function sourceWindow(lines: readonly string[], scroll: number, height: number): string {
  return lines
    .slice(scroll, scroll + height)
    .map(line => cleanLine(line, widest(height)))
    .join('\n')
}

// Where a link's target can start: after `](`, a definition's `]:`, an autolink's `<`, or raw HTML's `href=`.
const TARGET = /\]\(|\]:|<|href\s*=/gi
// A character reference a Markdown parser decodes inside a target.
const REFERENCE = /&(?:#x([0-9a-f]+);?|#(\d+);?|(colon|tab|newline);)/iy
const NAMED: Record<string, string> = { colon: ':', tab: '\t', newline: '\n' }

// The schemes a previewed file's links may keep: the web and mail.
const LINKS = new Set(['http', 'https', 'mailto'])
// Put before a target to disarm it. No scheme starts with it, so what follows is a URL to nowhere whatever
// its letters are; a prefix of letters could spell a real scheme (`no` before `tion:` is `notion:`).
const DISARM = '_'

// Where the target starting at `from` begins, when it reads as a URL a preview must not leave as a link, as a
// parser would decode it (backslash escapes dropped, character references decoded, an opening `<` or quote
// passed, any case); else -1.
//
// `file:` counts however it is written, whitespace and control characters inside it ignored, since opening
// one could run a program. Any other scheme outside LINKS, of any length (an app's own can be long), counts
// where it is a link's target and not code that looks like one:
// - of two letters or more (`C:` is a drive and `<T: Display>` a generic), and with no second colon after its
//   own (`std::move` and `<std::string>` are names);
// - in `<>` or quotes, with whatever whitespace inside; else in one piece, and with something right after the
//   colon, since a space ends such a target (`calls[i](value: 3)` is a call). A tab or a line ending written
//   as a character reference does not break the piece: it reaches the URL, whose parser drops it;
// - after a bare `<` (`isBare`), as an autolink is written: the scheme at once, and no space or `<` before
//   the `>` (`<Element: Equatable>` and `<xs:element name="a">` are code). `<Key:Hashable>` and `<xs:all>`
//   read as autolinks and are disarmed, as a renderer would link them outside a code block.
function unsafeTarget(text: string, from: number, isBare: boolean): number {
  let at = from
  let start = -1
  let scheme = ''
  let opened = false
  // Whitespace or a control character before the scheme, and one inside it that a URL would keep.
  let isLed = false
  let isSplit = false
  let isEnded = false
  while (at < text.length) {
    let c = text[at] ?? ''
    let width = 1
    if (c === '\\') {
      at++
      continue
    }
    if (c === '&') {
      REFERENCE.lastIndex = at
      const ref = REFERENCE.exec(text)
      if (ref) {
        const code = ref[1] ? parseInt(ref[1], 16) : ref[2] ? parseInt(ref[2], 10) : -1
        c = code < 0 ? (NAMED[(ref[3] ?? '').toLowerCase()] ?? '') : code <= 0x10ffff ? String.fromCodePoint(code) : '�'
        width = ref[0].length
      }
    }
    if (c <= ' ') {
      const isDropped = width > 1 && (c === '\t' || c === '\n' || c === '\r')
      if (start < 0) isLed = true
      else if (!isDropped) isSplit = true
      at += width
      continue
    }
    if (start < 0 && !opened && width === 1 && (c === '<' || c === '"' || c === "'")) {
      opened = true
      at++
      continue
    }
    if (start < 0) start = at
    at += width
    if (c === ':') {
      isEnded = true
      break
    }
    c = c.toLowerCase()
    if (!(scheme ? /[a-z0-9+.-]/ : /[a-z]/).test(c)) return -1
    scheme += c
  }
  if (!isEnded || !scheme) return -1
  if (scheme === 'file') return start
  if (LINKS.has(scheme) || scheme.length < 2 || text[at] === ':') return -1
  if (isBare) {
    if (opened || isLed || isSplit) return -1
    for (let i = at; i < text.length; i++) {
      const body = text[i] ?? ''
      if (body === '>') return start
      if (body <= ' ' || body === '<') return -1
    }
    return -1
  }
  const next = text[at]
  if (next === undefined) return -1
  return opened || (!isSplit && next > ' ') ? start : -1
}

// Markdown in which only links to the web and to mail stay links. Any other target that reads as a URL gets
// DISARM before its scheme, after which it names no scheme at all: `file:` first of all, since opening one
// could run a program, however it is written (`file\:`, `&#102;ile:`, `< file:`), and with it every scheme
// an app may answer to (unsafeTarget). A target in a code block gets it too: what counts as code is the
// renderer's to say, and too many disarmed is the safe side.
export function defangLinks(text: string): string {
  let out = ''
  let done = 0
  let last = -1
  for (const match of text.matchAll(TARGET)) {
    const start = unsafeTarget(text, (match.index ?? 0) + match[0].length, match[0] === '<')
    if (start < 0 || start === last) continue
    out += text.slice(done, start) + DISARM
    done = last = start
  }
  return out + text.slice(done)
}

// Markdown from line `scroll` on. A window that starts inside a fenced code block opens it again, so the rest
// still draws as code; a link that leads anywhere but the web or mail becomes plain text (defangLinks).
export function markdownWindow(lines: readonly string[], scroll: number, height: number): string {
  let fence: { marker: string; line: string } | null = null
  for (const line of lines.slice(0, scroll)) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (!marker) continue
    if (!fence) fence = { marker, line }
    else if (marker[0] === fence.marker[0] && marker.length >= fence.marker.length && line.trim() === marker) fence = null
  }
  const shown = lines.slice(scroll, scroll + height)
  return defangLinks(
    (fence ? [fence.line, ...shown] : shown).map(line => cleanLine(line, widest(height + 1))).join('\n'),
  )
}

// `git diff` output read into hunks; the file's header before the first `@@` and git's
// `\ No newline at end of file` notes are dropped.
export function parseDiff(out: string): Hunk[] {
  const hunks: Hunk[] = []
  let cur: Hunk | undefined
  for (const line of out.split('\n')) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (head) {
      cur = { oldStart: Number(head[1]), newStart: Number(head[2]), lines: [] }
      hunks.push(cur)
    } else if (cur && /^[ +-]/.test(line)) cur.lines.push(line)
  }
  return hunks
}

export const diffRows = (hunks: readonly Hunk[]): number => hunks.reduce((n, hunk) => n + hunk.lines.length, 0)

// The diff's lines from `scroll` on, at most `height`, as hunks Code can draw: a cut hunk gets a header that
// counts only the lines it keeps, so it still parses.
export function diffWindow(hunks: readonly Hunk[], scroll: number, height: number): string {
  const max = widest(height * 2)
  const out: string[] = []
  let row = 0
  for (const hunk of hunks) {
    if (row >= scroll + height) break
    let oldAt = hunk.oldStart
    let newAt = hunk.newStart
    let from: [number, number] | null = null
    const kept: string[] = []
    for (const line of hunk.lines) {
      if (row >= scroll && row < scroll + height) {
        from ??= [oldAt, newAt]
        kept.push(line)
      }
      row++
      if (line[0] !== '+') oldAt++
      if (line[0] !== '-') newAt++
    }
    if (!from) continue
    const olds = kept.filter(line => line[0] !== '+').length
    const news = kept.filter(line => line[0] !== '-').length
    out.push(`@@ -${from[0]},${olds} +${from[1]},${news} @@`, ...kept.map(line => `${line[0]}${cleanLine(line.slice(1), max)}`))
  }
  return out.join('\n')
}

// The row of a diff's lines (hunks end to end) where line `line` of the new file sits: the first row at or
// past it, a removed line counting where it was; the last row when the diff ends before it.
export function diffRowOf(hunks: readonly Hunk[], line: number): number {
  let row = 0
  for (const hunk of hunks) {
    let newAt = hunk.newStart
    for (const text of hunk.lines) {
      if (newAt >= line) return row
      row++
      if (text[0] !== '-') newAt++
    }
  }
  return Math.max(0, row - 1)
}

// The line of the new file where a tool's patch (Edit's or Write's `structuredPatch`) first adds or removes
// something; 0 when it changes nothing.
export function firstChange(patch: readonly { newStart: number; lines: readonly string[] }[]): number {
  for (const hunk of patch) {
    let at = hunk.newStart
    for (const line of hunk.lines) {
      if (line[0] === '+' || line[0] === '-') return at
      at++
    }
  }
  return 0
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

// A PNG's size in pixels, read off the first 24 bytes of its base64, or null when it is not a PNG.
export function pngSize(base64: string): { width: number; height: number } | null {
  const bytes: number[] = []
  let bits = 0
  let value = 0
  for (const c of base64.slice(0, 32)) {
    const at = B64.indexOf(c)
    if (at < 0) break
    value = ((value << 6) | at) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((value >> bits) & 0xff)
    }
  }
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null
  const word = (i: number) => bytes.slice(i, i + 4).reduce((n, b) => n * 256 + b, 0)
  return { width: word(16), height: word(20) }
}

// Cells for a picture of width × height pixels in at most columns × rows, keeping its shape (a cell is about
// twice as tall as it is wide), and no more than one cell per 8 pixels across, so an icon stays small.
export function fitCells(width: number, height: number, columns: number, rows: number): { columns: number; rows: number } {
  const tall = height / Math.max(1, width) / 2
  let across = Math.max(1, Math.min(columns, 255, Math.ceil(width / 8)))
  let down = Math.max(1, Math.round(across * tall))
  if (down > rows) {
    down = Math.max(1, rows)
    across = Math.max(1, Math.min(across, Math.round(down / tall)))
  }
  return { columns: across, rows: Math.min(255, down) }
}

export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
