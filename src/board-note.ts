export type BoardNoteText = {
  heading: string
  body: string
}

/** Plain text for the canvas note while preserving the lines it was written on. */
function plainNote(markdown: string): string {
  return markdown
    .split('\n')
    .map(line => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '\u2022 ').replace(/[*_`>]/g, '').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Split a leading Markdown heading so the canvas can give it heading type. */
export function boardNoteText(markdown: string | undefined): BoardNoteText {
  const source = markdown ?? ''
  const lines = source.split('\n')
  const first = lines.findIndex(line => line.trim())
  const heading = first >= 0 ? lines[first].trim().match(/^#{1,6}\s+(.+)$/) : null
  if (!heading) return { heading: '', body: plainNote(source) }

  return {
    heading: plainNote(heading[1]),
    body: plainNote(lines.filter((_, index) => index !== first).join('\n')),
  }
}
