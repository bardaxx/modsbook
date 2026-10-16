import type { ClientSurface, RenderElement } from 'claude-code'

import type { GraphNode, GraphProps, NodeState, TicketType } from '../types'

// The map drawn as the wayfinder article draws it: Start above, Destination below,
// each ticket a box under the tickets that block it, arrows along the blocking edges.

type GraphState = { sel: string | null; propSel: string | null; scroll: number }

const ACCENT = '#d97757'
const ARROW = '#a8a8a8'
const DIM = '#5a5a5a'
const TYPE_COLOR: Record<TicketType, string> = {
  grilling: '#e5737b',
  prototype: '#7fb4f5',
  research: '#b79cf5',
  task: '#e8a05c',
}
// One cell each, so the boxes line up in every terminal.
const ICON: Record<TicketType, string> = { grilling: '?', prototype: '◫', research: '⌕', task: '≡' }
const STATE_COLOR: Record<NodeState, string> = {
  resolved: '#5ccf9f',
  claimed: ACCENT,
  frontier: '#e2b867',
  blocked: DIM,
}
const MARK: Record<NodeState, string> = { resolved: '✓', claimed: '●', frontier: '◇', blocked: '○' }

const ROUND = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', tj: '┬', bj: '┴', out: '┬' }
const DOUBLE = { tl: '╔', tr: '╗', bl: '╚', br: '╝', h: '═', v: '║', tj: '╦', bj: '╩', out: '╤' }

const GAP = 2
const NODE_ROWS = 3

type Kind = 'node' | 'dummy' | 'start' | 'dest'
type Item = { key: string; kind: Kind; node: GraphNode | null; w: number; x: number; c: number }
type Seg = { from: Item; to: Item; isLit: boolean }
type Cell = { ch: string; color: string; bold: boolean; dim: boolean }

// Line directions a cell joins, merged into one box-drawing character.
const U = 1
const D = 2
const L = 4
const R = 8
const JOIN: Record<number, string> = {
  [U]: '│',
  [D]: '│',
  [U | D]: '│',
  [L]: '─',
  [R]: '─',
  [L | R]: '─',
  [D | R]: '╭',
  [D | L]: '╮',
  [U | R]: '╰',
  [U | L]: '╯',
  [U | D | R]: '├',
  [U | D | L]: '┤',
  [L | R | D]: '┬',
  [L | R | U]: '┴',
  [U | D | L | R]: '┼',
}

const wrapText = (text: string, room: number, max: number) => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > room) {
      lines.push(line)
      line = ''
    }
    line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  if (lines.length > max) {
    const kept = lines.slice(0, max)
    kept[max - 1] = `${(kept[max - 1] ?? '').slice(0, room - 1)}…`
    return kept
  }
  return lines.map(l => (l.length > room ? `${l.slice(0, room - 1)}…` : l))
}

export type Layout = {
  width: number
  rows: Cell[][]
  boxes: { id: string; x: number; y: number; w: number; layer: number; c: number }[]
}

export const layout = (props: GraphProps, sel: string | null, columns: number): Layout => {
  const nodes = props.nodes
  const byId = new Map(nodes.map(n => [n.id, n]))
  const edges = props.edges.filter(([a, b]) => byId.has(a) && byId.has(b) && a !== b)
  const destLayer = Math.max(0, ...nodes.map(n => n.layer)) + 1
  const hasIn = new Set(edges.map(([, b]) => b))
  const hasOut = new Set(edges.map(([a]) => a))

  const start: Item = { key: 'start', kind: 'start', node: null, w: 9, x: 0, c: 0 }
  const dest: Item = { key: 'dest', kind: 'dest', node: null, w: 15, x: 0, c: 0 }
  const layers: Item[][] = Array.from({ length: destLayer + 1 }, () => [])
  layers[0] = [start]
  layers[destLayer] = [dest]
  const items = new Map<string, Item>([
    ['start', start],
    ['dest', dest],
  ])
  for (const n of nodes) {
    const item: Item = { key: n.id, kind: 'node', node: n, w: 0, x: 0, c: 0 }
    items.set(n.id, item)
    layers[n.layer]?.push(item)
  }
  const layerOf = (key: string) => (key === 'start' ? 0 : key === 'dest' ? destLayer : (byId.get(key)?.layer ?? 0))
  const lanes = new Map<string, number>()
  const layerIndex = (it: Item) => (it.kind === 'dummy' ? (lanes.get(it.key) ?? 0) : layerOf(it.key))

  // Start leads to every ticket nothing blocks; every ticket nothing waits on leads to the destination.
  const full: [string, string][] = [
    ...nodes.filter(n => !hasIn.has(n.id)).map(n => ['start', n.id] as [string, string]),
    ...edges,
    ...nodes.filter(n => !hasOut.has(n.id)).map(n => [n.id, 'dest'] as [string, string]),
  ]
  if (!nodes.length) full.push(['start', 'dest'])

  // An edge across several rows runs through a one-cell lane in each row between.
  const segs: { from: string; to: string; isLit: boolean }[] = []
  for (const [a, b] of full) {
    const isLit = sel !== null && (a === sel || b === sel)
    let prev = a
    for (let l = layerOf(a) + 1; l < layerOf(b); l++) {
      const key = `lane:${a}>${b}:${l}`
      const lane: Item = { key, kind: 'dummy', node: null, w: 1, x: 0, c: 0 }
      items.set(key, lane)
      lanes.set(key, l)
      layers[l]?.push(lane)
      segs.push({ from: prev, to: key, isLit })
      prev = key
    }
    segs.push({ from: prev, to: b, isLit })
  }

  // Order each row by where its predecessors sit, then by where its successors sit, twice.
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const s of segs) {
    preds.set(s.to, [...(preds.get(s.to) ?? []), s.from])
    succs.set(s.from, [...(succs.get(s.from) ?? []), s.to])
  }
  const place = new Map<string, number>()
  const mark = (row: Item[]) => row.forEach((it, i) => place.set(it.key, (i + 0.5) / row.length))
  layers.forEach(mark)
  const sweep = (l: number, near: Map<string, string[]>) => {
    const row = layers[l] ?? []
    const at = (it: Item) => {
      const ps = (near.get(it.key) ?? []).map(k => place.get(k) ?? 0.5)
      return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : (place.get(it.key) ?? 0.5)
    }
    const ranked = row.map((it, i) => ({ it, i, at: at(it) }))
    ranked.sort((a, b) => a.at - b.at || a.i - b.i)
    layers[l] = ranked.map(r => r.it)
    mark(layers[l] ?? [])
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let l = 1; l <= destLayer; l++) sweep(l, preds)
    for (let l = destLayer - 1; l >= 1; l--) sweep(l, succs)
  }

  // As wide as the widest row lets every box be, and never narrower than a readable box.
  let w = 28
  for (const row of layers) {
    const boxes = row.filter(it => it.kind === 'node').length
    if (!boxes) continue
    const lanes = row.length - boxes
    w = Math.min(w, Math.floor((columns - (row.length - 1) * GAP - lanes) / boxes))
  }
  w = Math.max(14, w)
  for (const it of items.values()) if (it.kind === 'node') it.w = w
  const rowWidth = (row: Item[]) => row.reduce((sum, it) => sum + it.w, 0) + GAP * Math.max(0, row.length - 1)
  const width = Math.max(columns, ...layers.map(rowWidth))
  // Each box as near as its row allows to under its predecessors, the row kept in order and in the canvas.
  const mid = Math.floor(width / 2)
  for (const row of layers) {
    const wanted = row.map((it, i) => {
      if (it.kind === 'start' || it.kind === 'dest') return mid
      const ps = (preds.get(it.key) ?? []).map(k => items.get(k)?.c ?? mid)
      const even = Math.floor((width - rowWidth(row)) / 2) + rowWidth(row.slice(0, i)) + (i ? GAP : 0) + Math.floor(it.w / 2)
      return ps.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : even
    })
    let right = -GAP
    const xs = row.map((it, i) => {
      const x = Math.max((wanted[i] ?? mid) - Math.floor(it.w / 2), right + GAP)
      right = x + it.w
      return x
    })
    // Shift the row by how far it sits from where it wanted to be, as far as the canvas allows.
    const off = Math.round(row.reduce((sum, it, i) => sum + ((wanted[i] ?? mid) - Math.floor(it.w / 2) - (xs[i] ?? 0)), 0) / Math.max(1, row.length))
    const lo = -(xs[0] ?? 0)
    const hi = width - right
    const shift = Math.max(lo, Math.min(hi, off))
    row.forEach((it, i) => {
      it.x = (xs[i] ?? 0) + shift
      it.c = it.kind === 'start' || it.kind === 'dest' ? mid : it.x + Math.floor(it.w / 2)
    })
  }

  // The two ends' words, under their flags.
  const room = Math.max(16, Math.min(width - 4, 56))
  const startLines = wrapText(props.start, room, 2)
  const destLines = wrapText(props.destination, room, 3)
  const heightOf = (l: number) => (l === 0 ? 1 + startLines.length : l === destLayer ? 1 + destLines.length : NODE_ROWS)

  // Each gap gets one track per fan-out whose span overlaps another's.
  const gaps: { top: number; tracks: Map<string, number>; rows: number }[] = []
  let y = 0
  const tops: number[] = []
  for (let l = 0; l <= destLayer; l++) {
    tops[l] = y
    y += heightOf(l)
    if (l === destLayer) break
    const here = segs.filter(s => {
      const from = items.get(s.from)
      return from !== undefined && layerIndex(from) === l
    })
    const spans = new Map<string, [number, number]>()
    for (const s of here) {
      const a = items.get(s.from)
      const b = items.get(s.to)
      if (!a || !b || a.c === b.c) continue
      const was = spans.get(s.from) ?? [a.c, a.c]
      spans.set(s.from, [Math.min(was[0], b.c), Math.max(was[1], b.c)])
    }
    const tracks = new Map<string, number>()
    const ends: number[] = []
    for (const [key, [lo, hi]] of [...spans.entries()].sort((p, q) => p[1][0] - q[1][0])) {
      let t = ends.findIndex(end => end < lo - 1)
      if (t < 0) {
        t = ends.length
        ends.push(hi)
      } else ends[t] = hi
      tracks.set(key, t + 1)
    }
    gaps[l] = { top: y, tracks, rows: ends.length + 2 }
    y += ends.length + 2
  }
  const height = y

  // The canvas: line joins per cell, then the boxes and words drawn over them.
  const dirs: number[][] = Array.from({ length: height }, () => new Array<number>(width).fill(0))
  const lit: boolean[][] = Array.from({ length: height }, () => new Array<boolean>(width).fill(false))
  const fixed: (Cell | null)[][] = Array.from({ length: height }, () => new Array<Cell | null>(width).fill(null))
  const join = (row: number, col: number, d: number, isLit: boolean) => {
    if (row < 0 || row >= height || col < 0 || col >= width) return
    const line = dirs[row]
    if (line) line[col] = (line[col] ?? 0) | d
    if (isLit) {
      const l2 = lit[row]
      if (l2) l2[col] = true
    }
  }
  const put = (row: number, col: number, cell: Cell) => {
    const line = fixed[row]
    if (line && col >= 0 && col < width) line[col] = cell
  }
  const text = (row: number, col: number, s: string, style: Omit<Cell, 'ch'>) =>
    [...s].forEach((ch, i) => put(row, col + i, { ch, ...style }))
  const vertical = (col: number, from: number, to: number, isLit: boolean) => {
    for (let r = from; r <= to; r++) join(r, col, (r > from ? U : 0) | (r < to ? D : 0) | (from === to ? U | D : 0), isLit)
  }

  const arrows: { row: number; col: number; isLit: boolean }[] = []
  for (const s of segs) {
    const a = items.get(s.from)
    const b = items.get(s.to)
    if (!a || !b) continue
    const gap = gaps[layerIndex(a)]
    if (!gap) continue
    const first = gap.top
    const last = gap.top + gap.rows - 1
    const t = gap.tracks.get(s.from)
    if (t === undefined || a.c === b.c) {
      vertical(a.c, first, last, s.isLit)
      join(first, a.c, U, s.isLit)
    } else {
      const track = first + t
      vertical(a.c, first, track, s.isLit)
      join(first, a.c, U, s.isLit)
      const step = b.c > a.c ? 1 : -1
      join(track, a.c, step > 0 ? R : L, s.isLit)
      for (let col = a.c + step; col !== b.c; col += step) join(track, col, L | R, s.isLit)
      join(track, b.c, (step > 0 ? L : R) | D, s.isLit)
      vertical(b.c, track, last, s.isLit)
      join(track, b.c, D, s.isLit)
    }
    join(last, b.c, D, s.isLit)
    if (b.kind !== 'dummy') arrows.push({ row: last, col: b.c, isLit: s.isLit })
  }

  // A lane runs straight through its row.
  for (const it of items.values()) {
    if (it.kind !== 'dummy') continue
    const l = layerIndex(it)
    const top = tops[l] ?? 0
    const isLit = segs.some(s => (s.from === it.key || s.to === it.key) && s.isLit)
    for (let r = top; r < top + heightOf(l); r++) join(r, it.c, U | D, isLit)
  }

  const boxes: Layout['boxes'] = []
  for (const row of layers)
    for (const it of row) {
      const l = layerIndex(it)
      const top = tops[l] ?? 0
      if (it.kind === 'start' || it.kind === 'dest') {
        const label = it.kind === 'start' ? '⚑ Start' : '⚑ Destination'
        text(top, it.c - Math.floor(label.length / 2), label, { color: 'white', bold: true, dim: false })
        const lines = it.kind === 'start' ? startLines : destLines
        lines.forEach((line, i) =>
          text(top + 1 + i, Math.floor((width - line.length) / 2), line, { color: ARROW, bold: false, dim: true }),
        )
        continue
      }
      const n = it.node
      if (it.kind !== 'node' || !n) continue
      boxes.push({ id: n.id, x: it.x, y: top, w: it.w, layer: l, c: it.c })
      const isSel = n.id === sel
      const color = n.state === 'blocked' ? DIM : n.type ? TYPE_COLOR[n.type] : ARROW
      const frame = { color: isSel ? 'white' : color, bold: isSel, dim: n.state === 'resolved' && !isSel }
      const k = isSel ? DOUBLE : ROUND
      const inner = it.w - 2
      text(top, it.x, `${k.tl}${k.h.repeat(3)}${k.tj}${k.h.repeat(inner - 4)}${k.tr}`, frame)
      text(top + 2, it.x, `${k.bl}${k.h.repeat(3)}${k.bj}${k.h.repeat(inner - 4)}${k.br}`, frame)
      if (segs.some(s => s.from === n.id)) put(top + 2, it.c, { ch: k.out, ...frame })
      for (const col of [it.x, it.x + 4, it.x + it.w - 1]) put(top + 1, col, { ch: k.v, ...frame })
      text(top + 1, it.x + 1, ` ${n.type ? ICON[n.type] : '·'} `, { color, bold: true, dim: n.state === 'resolved' && !isSel })
      const room2 = it.w - 9
      const mark2 = n.isNext ? '▶' : MARK[n.state]
      const title = n.title.length > room2 ? `${n.title.slice(0, room2 - 1)}…` : n.title
      put(top + 1, it.x + 5, { ch: ' ', color, bold: false, dim: false })
      put(top + 1, it.x + 6, { ch: mark2, color: STATE_COLOR[n.state], bold: true, dim: false })
      text(top + 1, it.x + 7, ` ${title.padEnd(room2)}`, {
        color: n.state === 'blocked' ? ARROW : 'white',
        bold: isSel || n.isMine || n.isNext,
        dim: n.state === 'resolved' || n.state === 'blocked',
      })
    }

  const rows: Cell[][] = []
  for (let r = 0; r < height; r++) {
    const line: Cell[] = []
    for (let col = 0; col < width; col++) {
      const f = fixed[r]?.[col]
      if (f) {
        line.push(f)
        continue
      }
      const d = dirs[r]?.[col] ?? 0
      const isLit = lit[r]?.[col] ?? false
      line.push({ ch: d ? (JOIN[d] ?? '┼') : ' ', color: isLit ? ACCENT : ARROW, bold: isLit, dim: false })
    }
    rows.push(line)
  }
  for (const a of arrows) {
    const line = rows[a.row]
    if (line && !fixed[a.row]?.[a.col]) line[a.col] = { ch: '▼', color: a.isLit ? ACCENT : ARROW, bold: a.isLit, dim: false }
  }
  return { width, rows, boxes }
}

/** Where the arrows go from a box: along its edges first, else to the nearest box in that direction. */
const move = (props: GraphProps, boxes: Layout['boxes'], from: string | null, key: string): string | null => {
  if (!boxes.length) return null
  const here = boxes.find(b => b.id === from)
  if (!here) {
    const mine = props.nodes.find(n => n.isMine) ?? props.nodes.find(n => n.isNext)
    return mine?.id ?? boxes[0]?.id ?? null
  }
  const nearest = (list: typeof boxes) =>
    [...list].sort((a, b) => Math.abs(a.c - here.c) - Math.abs(b.c - here.c))[0]?.id ?? here.id
  if (key === 'left' || key === 'right') {
    const row = boxes.filter(b => b.layer === here.layer).sort((a, b) => a.x - b.x)
    const i = row.findIndex(b => b.id === here.id)
    return row[i + (key === 'left' ? -1 : 1)]?.id ?? here.id
  }
  const isDown = key === 'down'
  const linked = props.edges
    .filter(([a, b]) => (isDown ? a === here.id : b === here.id))
    .map(([a, b]) => (isDown ? b : a))
  const along = boxes.filter(b => linked.includes(b.id))
  if (along.length) return nearest(along)
  const layers = [...new Set(boxes.map(b => b.layer))].sort((a, b) => a - b)
  const next = isDown ? layers.find(l => l > here.layer) : [...layers].reverse().find(l => l < here.layer)
  return next === undefined ? here.id : nearest(boxes.filter(b => b.layer === next))
}

const KEYS: Record<string, string> = { left: 'left', right: 'right', up: 'up', down: 'down', h: 'left', l: 'right', k: 'up', j: 'down' }

export default function Graph(props: GraphProps, surface: ClientSurface<GraphState>): RenderElement {
  const { Box, Text } = surface.elements
  const st = surface.state
  // The card the hooks module opened wins; a card closed keeps the box this graph selected.
  const sel = st && (st.propSel === props.selected || props.selected === null) ? st.sel : props.selected
  const columns = Math.max(20, surface.columns || props.columns)
  const { width, rows, boxes } = layout(props, sel, columns)

  // Keep the selected box in view when the map is wider than the pane.
  const box = boxes.find(b => b.id === sel)
  let scroll = Math.min(Math.max(0, st?.scroll ?? 0), Math.max(0, width - columns))
  if (box && box.x < scroll) scroll = box.x
  if (box && box.x + box.w > scroll + columns) scroll = box.x + box.w - columns

  const choose = (next: string | null, focus: string | null) => {
    surface.setState({ sel: next, propSel: props.selected, scroll })
    surface.post({ focus })
  }
  surface.onKey(e => {
    const dir = KEYS[e.key]
    if (dir) {
      const next = move(props, boxes, sel, dir)
      choose(next, next)
    } else if ((e.key === 'return' || e.key === ' ') && sel) choose(sel, props.selected === sel ? null : sel)
  })
  surface.onPointer(e => {
    if (e.type !== 'down' || e.button !== 'left') return
    const x = e.x + scroll
    const hit = boxes.find(b => x >= b.x && x < b.x + b.w && e.y >= b.y && e.y < b.y + NODE_ROWS)
    if (hit) choose(hit.id, props.selected === hit.id ? null : hit.id)
  })

  return (
    <Box flexDirection="column">
      {rows.map((line, r) => {
        const cells = line.slice(scroll, scroll + columns)
        const runs: Cell[] = []
        for (const cell of cells) {
          const last = runs[runs.length - 1]
          if (last && last.color === cell.color && last.bold === cell.bold && last.dim === cell.dim) last.ch += cell.ch
          else runs.push({ ...cell })
        }
        return (
          <Text key={`r${r}`} wrap="truncate-end">
            {runs.map((run, i) => (
              <Text key={`r${r}-${i}`} color={run.color} bold={run.bold} dimColor={run.dim}>
                {run.ch}
              </Text>
            ))}
          </Text>
        )
      })}
      {width > columns && (
        <Text dimColor>
          {scroll > 0 ? '◂ ' : '  '}
          {Math.round((scroll / Math.max(1, width - columns)) * 100)}% of a wider map
          {scroll < width - columns ? ' ▸' : ''}
        </Text>
      )}
    </Box>
  )
}
