/**
 * The small markdown subset the board's notes and composer share: headings,
 * bold, italic, inline code, links, quotes and simple lists. Rendering and
 * syntax highlighting run off the same token pass so the composer's overlay
 * and the note card can never disagree about what a line means.
 */

const INLINE = /(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\[[^\]\n]+\]\([^)\n]+\))/g

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineHtml(escaped: string): string {
  return escaped.replace(INLINE, (m) => {
    if (m.startsWith('**')) return `<strong>${m.slice(2, -2)}</strong>`
    if (m.startsWith('*')) return `<em>${m.slice(1, -1)}</em>`
    if (m.startsWith('`')) return `<code>${m.slice(1, -1)}</code>`
    const cut = m.indexOf('](')
    const href = m.slice(cut + 2, -1)
    const safe = /^https?:\/\//i.test(href) ? href : '#'
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${m.slice(1, cut)}</a>`
  })
}

/** Note markdown to HTML. Input is escaped first, so raw HTML never survives. */
export function renderMarkdown(src: string | undefined): string {
  if (!src || !src.trim()) return ''
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null } }
  for (const raw of src.split('\n')) {
    const line = escapeHtml(raw.trimEnd())
    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+\.\s+(.*)$/)
    const quote = line.match(/^&gt;\s?(.*)$/)
    if (heading) { closeList(); out.push(`<h3>${inlineHtml(heading[2])}</h3>`) }
    else if (bullet) {
      if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul>') }
      out.push(`<li>${inlineHtml(bullet[1])}</li>`)
    } else if (numbered) {
      if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol>') }
      out.push(`<li>${inlineHtml(numbered[1])}</li>`)
    } else if (quote) { closeList(); out.push(`<blockquote>${inlineHtml(quote[1])}</blockquote>`) }
    else if (!line.trim()) closeList()
    else { closeList(); out.push(`<p>${inlineHtml(line)}</p>`) }
  }
  closeList()
  return out.join('')
}

function inlineSyntax(escaped: string): string {
  return escaped.replace(INLINE, (m) => {
    if (m.startsWith('**'))
      return `<span class="md-syntax">**</span><span class="md-bold">${m.slice(2, -2)}</span><span class="md-syntax">**</span>`
    if (m.startsWith('*'))
      return `<span class="md-syntax">*</span><span class="md-italic">${m.slice(1, -1)}</span><span class="md-syntax">*</span>`
    if (m.startsWith('`'))
      return `<span class="md-syntax">\`</span><span class="md-code">${m.slice(1, -1)}</span><span class="md-syntax">\`</span>`
    const cut = m.indexOf('](')
    return `<span class="md-syntax">[</span><span class="md-link">${m.slice(1, cut)}</span>`
      + `<span class="md-syntax">](${m.slice(cut + 2)}</span>`
  })
}

/**
 * The composer's highlight layer sits under a transparent textarea, so this
 * must return the source character for character, wrapped but never changed.
 */
export function highlightMarkdown(src: string): string {
  return src.split('\n').map((raw) => {
    const line = escapeHtml(raw)
    const heading = line.match(/^(#{1,6}\s)(.*)$/)
    if (heading) return `<span class="md-syntax">${heading[1]}</span><span class="md-heading">${inlineSyntax(heading[2])}</span>`
    if (/^&gt;\s?/.test(line)) return `<span class="md-quote">${inlineSyntax(line)}</span>`
    const bullet = line.match(/^(\s*[-*]\s)(.*)$/)
    if (bullet) return `<span class="md-syntax">${bullet[1]}</span>${inlineSyntax(bullet[2])}`
    return inlineSyntax(line)
  }).join('\n') + '\n'
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
