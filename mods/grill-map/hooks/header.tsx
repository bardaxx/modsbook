// The head every modsbook pane opens with: a terminal panel, its titles set in the border as lazygit and tmux
// set theirs, a prompt naming the mod, and a nod to mattpocock/skills, the skills the mods follow.
// The same in each mod, only the name changes. One identical copy in each mod; scripts/check.sh fails when they differ.

import type { BoxProps, ElementConstructor, TextProps } from 'claude-code'

export type HeaderElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
}

const EDGE = '#4a4a4a'
const ACCENT = '#d97757'
const TOP = 'modsbook'
const NOD = 'mattpocock/skills'

/** Three rows drawn to the pane's width: `modsbook` in the top border, `❯ <name> ▌`, the nod in the bottom one. */
export const header = ({ Box, Text }: HeaderElements, name: string, columns: number) => {
  const width = Math.max(TOP.length + NOD.length + 10, columns)
  const rule = (n: number) => '─'.repeat(Math.max(0, n))
  const room = width - 4
  const prompt = name.length + 4 > room ? `${name.slice(0, Math.max(1, room - 5))}…` : name
  return (
    <Box key="header" flexDirection="column">
      <Text>
        <Text color={EDGE}>╭─ </Text>
        <Text dimColor>{TOP}</Text>
        <Text color={EDGE}>{` ${rule(width - TOP.length - 5)}╮`}</Text>
      </Text>
      <Text>
        <Text color={EDGE}>│ </Text>
        <Text color={ACCENT}>❯ </Text>
        <Text bold>{prompt}</Text>
        <Text color={ACCENT}> ▌</Text>
        <Text color={EDGE}>{`${' '.repeat(Math.max(0, room - prompt.length - 4))} │`}</Text>
      </Text>
      <Text>
        <Text color={EDGE}>{`╰${rule(width - NOD.length - 5)} `}</Text>
        <Text dimColor italic>
          {NOD}
        </Text>
        <Text color={EDGE}> ─╯</Text>
      </Text>
    </Box>
  )
}
