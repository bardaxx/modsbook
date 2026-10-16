// The head every modsbook pane opens with: the book and the mod named in the mod's own color with the state it is
// in, a legend of the three mods with this one lit, and a strip of braille dots that drifts while the mod works.
// One identical copy in each mod; scripts/check.sh fails when they differ.

import type { BoxProps, ElementConstructor, TextProps } from 'claude-code'

export type HeaderElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
}

/** What the mod is doing: one word, drawn after its name, and whether the strip drifts. */
export type HeaderState = { state: string; isLive: boolean }

/** The book's mods, each in the color its header, legend square and strip are drawn in. */
const MODS = [
  { name: 'grill-map', color: '#d97757' },
  { name: 'wayfinder-map', color: '#b1b9f9' },
  { name: 'spec-map', color: '#5cc89c' },
] as const

const BOOK = 'MODSBOOK'
/** How often a mod's `session.start` timer redraws the pane while `isDrifting()`. */
export const FRAME_MS = 150

let drifting = false

/** Whether the header last drew a live state: the strip moves only when the pane is redrawn each frame. */
export const isDrifting = () => drifting

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

/** Three rows drawn to the pane's width: `MODSBOOK · <MOD> <STATE>`, the legend, the strip. */
export const header = ({ Box, Text }: HeaderElements, name: string, columns: number, at: HeaderState) => {
  drifting = at.isLive
  const color = MODS.find(m => m.name === name)?.color ?? MODS[0].color
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
      <Box justifyContent="center">
        <Text wrap="truncate-end">
          {MODS.map((m, i) => (
            <Text key={m.name}>
              {i > 0 ? '  ' : ''}
              <Text color={m.color} dimColor={m.name !== name}>
                ■
              </Text>
              <Text dimColor={m.name !== name} bold={m.name === name}>
                {` ${m.name}`}
              </Text>
            </Text>
          ))}
        </Text>
      </Box>
      <Text color={color} dimColor={!at.isLive} wrap="truncate-end">
        {strip(Math.max(8, columns), frame, at.isLive)}
      </Text>
    </Box>
  )
}
