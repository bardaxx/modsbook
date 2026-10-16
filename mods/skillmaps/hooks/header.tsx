// The head every skillmaps pane opens with: the plugin and the map named in the map's own color with the state it
// is in, a legend of the maps the settings turned on (a press opens that one), and a strip of braille dots that
// drifts while the map works.

import type { BoxProps, ButtonProps, ElementConstructor, TextProps } from 'claude-code'

export type HeaderElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

/** What the map is doing: one word, drawn after its name, and whether the strip drifts. */
export type HeaderState = { state: string; isLive: boolean }

/** The maps, each in the color its title, legend square and strip are drawn in. */
const COLORS: Record<string, string> = {
  'grill-map': '#d97757',
  'wayfinder-map': '#b1b9f9',
  'spec-map': '#5cc89c',
}

const BOOK = 'SKILLMAPS'

/** How often the plugin's `session.start` timer redraws while `isDrifting()`. */
export const FRAME_MS = 150

/** The panes whose header last drew a live state. */
const live = new Set<string>()
let legend: string[] = Object.keys(COLORS)

/** Whether any pane's header last drew a live state: the strip moves only when the panes redraw each frame. */
export const isDrifting = () => live.size > 0

/** The maps the legend lists: the ones the settings turned on. */
export const setLegend = (names: string[]) => {
  legend = names
}

/** A hash of three integers to [0, 1): the same cell and frame always draw the same dots. */
const noise = (a: number, b: number, c: number) => {
  let h = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** One row of braille cells: sparse dots at rest, a crest of denser ones travelling left to right while live. */
const strip = (width: number, frame: number, isLive: boolean) => {
  let out = ''
  for (let i = 0; i < width; i++) {
    const crest = isLive ? Math.max(0, Math.sin((i - frame * 0.9) / 5)) : 0
    const density = 0.08 + 0.42 * crest * crest
    let bits = 0
    for (let k = 0; k < 8; k++) if (noise(i, k, isLive ? frame : 0) < density) bits |= 1 << k
    out += String.fromCharCode(0x2800 + bits)
  }
  return out
}

/** Three rows drawn to the pane's width: `SKILLMAPS · <MAP> <STATE>`, the legend, the strip. */
export const header = (
  { Box, Text, Button }: HeaderElements,
  name: string,
  columns: number,
  at: HeaderState,
  onPick: (name: string) => void,
) => {
  if (at.isLive) live.add(name)
  else live.delete(name)
  const color = COLORS[name] ?? '#d97757'
  const frame = Math.floor(Date.now() / FRAME_MS)
  return (
    <Box key="header" flexDirection="column" marginBottom={1}>
      <Box justifyContent="center">
        <Text wrap="truncate-end">
          <Text bold>{BOOK}</Text>
          <Text dimColor> · </Text>
          <Text bold color={color}>
            {name.toUpperCase()}
          </Text>
          <Text bold> {at.state.toUpperCase()}</Text>
        </Text>
      </Box>
      {legend.length > 1 && (
        <Box justifyContent="center" flexDirection="row">
          {legend.map((m, i) => (
            <Box key={`legend-${m}`} flexDirection="row">
              <Text color={COLORS[m]} dimColor={m !== name}>
                {i > 0 ? '  ■ ' : '■ '}
              </Text>
              <Button key={`map-${m}`} plain dimColor={m !== name} label={m} onPress={() => onPick(m)} />
            </Box>
          ))}
        </Box>
      )}
      <Text color={color} dimColor={!at.isLive} wrap="truncate-end">
        {strip(Math.max(8, columns), frame, at.isLive)}
      </Text>
    </Box>
  )
}
