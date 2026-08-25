import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { boardNoteText } from '../src/board-note.ts'

const board = readFileSync(new URL('../src/board.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

test('a leading Markdown heading stays separate from the board note body', () => {
  assert.deepEqual(boardNoteText('# Build-up pattern\n\nPass forwards.'), {
    heading: 'Build-up pattern',
    body: 'Pass forwards.',
  })
  assert.deepEqual(boardNoteText('Pass forwards.'), {
    heading: '',
    body: 'Pass forwards.',
  })
  assert.deepEqual(boardNoteText('## Heading only'), {
    heading: 'Heading only',
    body: '',
  })
})

test('changing heading syntax cannot be hidden by the board note cache', () => {
  assert.match(board, /if \(source === this\.noteSource\) return/)
  assert.match(board, /fontSize: 24,[\s\S]{0,80}fontStyle: 'bold'/)
  assert.match(board, /if \(this\.noteText\) y \+= 10/)
})

test('playback styles its visible and measured headings together', () => {
  assert.match(styles, /\.seqPlayer__noteText h3,\s*\.seqPlayer__noteMeasure h3 \{[\s\S]{0,220}font-size: 15px;[\s\S]{0,120}font-weight: 700;/)
  assert.match(styles, /\.seqPlayer__sheetBody h3 \{[\s\S]{0,180}font-size: 19px;[\s\S]{0,120}font-weight: 700;/)
})
