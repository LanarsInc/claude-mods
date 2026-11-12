// The tree's rows, drawn on the surface itself: hover, clicks and keys stay here, and only a click or a key
// crosses to the hooks module (as a `ui.message` post). The hooks module sends the visible window as props.

import type { ClientModule } from 'claude-code'

export type RowSpec = {
  id: string
  depth: number
  icon: string
  name: string
  color?: string
  bold?: boolean
  dim?: boolean
  // One cell before the name: Claude's activity on this row.
  mark?: string
  markColor?: string
  right?: string
  rightColor?: string
}

export type RowsProps = {
  rows: RowSpec[]
  cursor: string
  cursorBg: string
  hoverBg: string
}

type Local = { hover: number }

const Rows: ClientModule<RowsProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    state = { hover: -1 }
    surface.setState(state)
  }

  // Set on every draw so the listeners see this draw's rows.
  surface.onPointer(e => {
    const cur = surface.state ?? { hover: -1 }
    const row = e.y >= 0 && e.y < props.rows.length ? props.rows[e.y] : undefined
    if (e.type === 'leave' || !row) {
      if (cur.hover !== -1) surface.setState({ hover: -1 })
      return
    }
    if (e.type === 'move' && !e.button && cur.hover !== e.y) surface.setState({ hover: e.y })
    if (e.type === 'down' && (e.button ?? 'left') === 'left') surface.post({ press: row.id })
  })
  // Shift with a letter arrives as the capital (J and K scroll the preview).
  surface.onKey(e => surface.post({ key: e.shift && e.key.length === 1 ? e.key.toUpperCase() : e.key }))

  return (
    <Box flexDirection="column">
      {props.rows.map((r, i) => (
        <Box
          flexDirection="row"
          height={1}
          overflow="hidden"
          backgroundColor={r.id === props.cursor ? props.cursorBg : i === state.hover ? props.hoverBg : undefined}
        >
          <Text color={r.markColor}>{r.mark || ' '}</Text>
          <Box flexShrink={1} overflow="hidden">
            <Text wrap="truncate-end" color={r.color} bold={r.bold} dimColor={r.dim}>
              {`${'  '.repeat(r.depth)}${r.icon} ${r.name}`}
            </Text>
          </Box>
          <Box flexGrow={1} />
          <Text color={r.rightColor} dimColor={!r.rightColor}>
            {r.right ? ` ${r.right} ` : ' '}
          </Text>
        </Box>
      ))}
    </Box>
  )
}

export default Rows
