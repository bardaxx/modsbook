// The head every skillmaps pane opens with: the plugin and the map named in the map's own color with the state it
// is in, a legend of the maps the settings turned on (a press opens that one), and a strip of braille dots that
// each map animates its own way: grill-map's flames, wayfinder-map's traveller in the fog, spec-map's conveyor. It
// moves every frame while the map works and at a slower beat at rest, and stops once the pane is off screen.

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

/** How often the plugin's `session.start` timer asks `isDrifting()`: the frame rate of a working map. */
export const FRAME_MS = 150
/** A map at rest still moves, at this slower beat. */
const IDLE_MS = 600
/** A pane that drew no header for this long is off screen: its strip stops. */
const GONE_MS = 2000

/** Each pane's last header: when it was drawn and whether its map was working. */
const drawn = new Map<string, { at: number; isLive: boolean }>()
let legend: string[] = Object.keys(COLORS)

/** Whether a pane on screen is due a new frame: every frame while its map works, every beat at rest. */
export const isDrifting = () => {
  const now = Date.now()
  for (const d of drawn.values()) {
    if (now - d.at > GONE_MS) continue
    if (d.isLive || Math.floor(now / IDLE_MS) !== Math.floor(d.at / IDLE_MS)) return true
  }
  return false
}

/** The maps the legend lists: the ones the settings turned on. */
export const setLegend = (names: string[]) => {
  legend = names
}

/** A hash of three integers to [0, 1): the same cell and frame always draw the same dots. */
const noise = (a: number, b: number, c: number) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2147483647)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// A braille cell's dots, bottom to top: its left column, then its right.
const LEFT = [0x40, 0x04, 0x02, 0x01]
const RIGHT = [0x80, 0x20, 0x10, 0x08]
const cell = (bits: number) => String.fromCharCode(0x2800 + bits)
/** A half-cell filled from the bottom, `h` dots high. */
const column = (dots: number[], h: number) =>
  dots.slice(0, Math.max(0, Math.min(4, h))).reduce((bits, dot) => bits | dot, 0)
/** Each of a cell's eight dots on with chance `p`. */
const sprinkle = (i: number, t: number, p: number, salt: number) => {
  let bits = 0
  for (let k = 0; k < 8; k++) if (noise(i * 8 + k, t, salt) < p) bits |= 1 << k
  return bits
}

/** grill-map: flames, each half-cell a flicker of heat rising from the bottom, a spark above now and then. */
const flames = (width: number, t: number) => {
  const heat = (x: number) => Math.round(0.6 + 1.6 * Math.sin(x / 3.1 + t / 4) * Math.sin(x / 7.3 - t / 9) + 2 * noise(x, t, 1))
  let out = ''
  for (let i = 0; i < width; i++) {
    let bits = column(LEFT, heat(2 * i)) | column(RIGHT, heat(2 * i + 1))
    if (noise(i, t, 2) < 0.06) bits |= noise(i, t, 3) < 0.5 ? 0x01 : 0x08
    out += cell(bits)
  }
  return out
}

/** wayfinder-map: fog drifting slowly left, and a traveller wandering through it at random, its trail fading. */
const wander = (width: number, t: number) => {
  // Three slow waves out of step: a walk that turns back and forth and never repeats soon.
  const at = width * (0.5 + 0.22 * Math.sin(t / 17) + 0.15 * Math.sin(t / 7.3 + 1) + 0.08 * Math.sin(t / 3.1 + 2))
  let out = ''
  for (let i = 0; i < width; i++) {
    const near = Math.min(Math.abs(i - at), width - Math.abs(i - at))
    const isTrail = near < 6
    out += cell(sprinkle(i + Math.floor(t / 3), isTrail ? t : Math.floor(t / 2), 0.07 + (isTrail ? 0.55 * (1 - near / 6) : 0), 5))
  }
  return out
}

/** spec-map: a conveyor, packets of dots flowing left to right along a thin track. */
const conveyor = (width: number, t: number) => {
  let out = ''
  for (let i = 0; i < width; i++) {
    const x = i - t
    const isPacket = noise(Math.floor(x / 4), 0, 6) < 0.45 && ((x % 4) + 4) % 4 !== 3
    out += cell(isPacket ? sprinkle(i, t, 0.6, 7) | 0x24 : noise(i, t, 8) < 0.5 ? 0x24 : 0x04)
  }
  return out
}

const STRIPS: Record<string, (width: number, t: number) => string> = {
  'grill-map': flames,
  'wayfinder-map': wander,
  'spec-map': conveyor,
}

/** Three rows drawn to the pane's width: `SKILLMAPS · <MAP> <STATE>`, the legend, the strip. */
export const header = (
  { Box, Text, Button }: HeaderElements,
  name: string,
  columns: number,
  at: HeaderState,
  onPick: (name: string) => void,
) => {
  const now = Date.now()
  drawn.set(name, { at: now, isLive: at.isLive })
  const color = COLORS[name] ?? '#d97757'
  // Working, the strip moves every frame; at rest, every beat.
  const frame = Math.floor(now / (at.isLive ? FRAME_MS : IDLE_MS))
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
        {(STRIPS[name] ?? flames)(Math.max(8, columns), frame)}
      </Text>
    </Box>
  )
}
