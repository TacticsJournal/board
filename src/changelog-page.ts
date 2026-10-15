/**
 * The public history at /changelog. It renders the same build-time entries the
 * board's What's new panel uses, so the two can never disagree, and it stays a
 * separate entry so the page does not pull in the editor.
 */

import './styles.css'
import { entries, entryDate, entryMonth, type ChangelogEntry } from './changelog.ts'

const THEME_KEY = 'tbm-theme-v1'

function applyStoredTheme() {
  const saved = (() => { try { return localStorage.getItem(THEME_KEY) } catch { return null } })()
  const dark = saved === 'dark' || (saved !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.setAttribute('data-theme-resolved', dark ? 'dark' : 'light')
}

function esc(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function entryMarkup(entry: ChangelogEntry) {
  return `<li class="site-changelog-entry">
      <div class="site-changelog-entry-text">
        <p class="site-changelog-meta"><time datetime="${entry.date}">${esc(entryDate(entry.date))}</time>${entry.tag ? `<span class="site-changelog-tag">${esc(entry.tag)}</span>` : ''}</p>
        <h3 class="site-changelog-entry-title">${esc(entry.title)}</h3>
        ${entry.body ? `<p class="site-changelog-body">${esc(entry.body)}</p>` : ''}
      </div>
    </li>`
}

function monthsMarkup(list: ChangelogEntry[]) {
  const months: { title: string; entries: ChangelogEntry[] }[] = []
  for (const entry of list) {
    const title = entryMonth(entry.date)
    const last = months[months.length - 1]
    if (last && last.title === title) last.entries.push(entry)
    else months.push({ title, entries: [entry] })
  }
  return months.map(month => `<section class="changelogMonth">
      <h2 class="changelogMonthTitle">${esc(month.title)}</h2>
      <ol class="site-changelog-list">${month.entries.map(entryMarkup).join('')}</ol>
    </section>`).join('')
}

const list = entries()
const root = document.getElementById('changelog')!
root.innerHTML = `<header>
    <h1 class="changelogPageTitle">What's new</h1>
    <p class="changelogPageIntro">Every change to the Tactics Journal board, newest first.</p>
    <a class="changelogPageBack" href="/">Back to the board</a>
  </header>
  ${list.length ? monthsMarkup(list) : '<p class="changelogEmpty">Nothing has been recorded yet.</p>'}`

applyStoredTheme()
