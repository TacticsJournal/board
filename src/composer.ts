import { icon } from './icons'
import { countWords, highlightMarkdown, renderMarkdown } from './markdown'

/**
 * The note editor: the community composer, brought over so writing a note on
 * a board reads like writing a post. A transparent textarea sits over a
 * highlight layer, so the Markdown marks stay visible while you type.
 */
export function openComposer(initial: string, onSave: (text: string) => void) {
  const composer = document.createElement('div')
  composer.className = 'composer'
  composer.innerHTML = `
    <div class="composer__header">
      <button type="button" class="composer__cancel" data-cmp="cancel">Cancel</button>
      <div class="composer__count" data-cmp="count">0 Characters&nbsp;&nbsp;&nbsp;0 Words</div>
      <button type="button" class="composer__post" data-cmp="done">Done</button>
    </div>
    <div class="composer__editor">
      <pre class="composer__highlight" aria-hidden="true" data-cmp="highlight"></pre>
      <textarea class="composer__body" data-cmp="body" maxlength="5000" placeholder="Write in Markdown&#8230;"></textarea>
      <div class="composer__pv" data-cmp="preview" hidden></div>
    </div>
    <div class="composer__footer">
      <div class="composer__toolbar">
        <button type="button" class="composer__tool" data-cmp="link" title="Link">${icon('link')}</button>
        <button type="button" class="composer__preview-btn" data-cmp="preview-btn">Preview</button>
      </div>
    </div>`
  document.body.appendChild(composer)
  document.body.classList.add('composer-open')

  const body = composer.querySelector<HTMLTextAreaElement>('[data-cmp="body"]')!
  const highlight = composer.querySelector<HTMLElement>('[data-cmp="highlight"]')!
  const preview = composer.querySelector<HTMLElement>('[data-cmp="preview"]')!
  const previewBtn = composer.querySelector<HTMLElement>('[data-cmp="preview-btn"]')!
  const count = composer.querySelector<HTMLElement>('[data-cmp="count"]')!
  let previewing = false

  const sync = () => {
    highlight.innerHTML = highlightMarkdown(body.value)
    const words = countWords(body.value)
    count.innerHTML = `${body.value.length} Characters&nbsp;&nbsp;&nbsp;${words} Word${words === 1 ? '' : 's'}`
    body.style.height = 'auto'
    body.style.height = `${body.scrollHeight}px`
    if (previewing) preview.innerHTML = renderMarkdown(body.value)
  }
  const setPreview = (on: boolean) => {
    previewing = on
    preview.hidden = !on
    body.hidden = on
    highlight.hidden = on
    previewBtn.classList.toggle('composer__preview-btn--active', on)
    if (on) preview.innerHTML = renderMarkdown(body.value)
  }
  const close = (save: boolean) => {
    if (save) onSave(body.value)
    composer.remove()
    document.body.classList.remove('composer-open')
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(false) }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close(true) }
  }

  body.value = initial
  body.addEventListener('input', sync)
  composer.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest<HTMLElement>('[data-cmp]')?.dataset.cmp
    if (act === 'cancel') close(false)
    if (act === 'done') close(true)
    if (act === 'preview-btn') setPreview(!previewing)
    if (act === 'link') {
      const start = body.selectionStart
      const end = body.selectionEnd
      const text = body.value.slice(start, end) || 'text'
      body.setRangeText(`[${text}](https://)`, start, end, 'end')
      body.focus()
      sync()
    }
  })
  document.addEventListener('keydown', onKey)
  sync()
  body.focus()
  body.setSelectionRange(body.value.length, body.value.length)
}
