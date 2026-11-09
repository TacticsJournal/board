/**
 * The header search panel: a box and a list of matching Tactics Journal
 * posts from the site's public keyword search, GET /api/search. Mirrors
 * tacticsjournal.com's js/site-search.js. No session or sign-in: the search is
 * public, so the request carries no credentials. Results open on the site.
 */

import { TJ_ORIGIN } from './origin'

const TJ = TJ_ORIGIN
const DEBOUNCE_MS = 200

interface SearchResult {
  title: string
  url: string
  date: string
}

interface SearchResponse {
  total: number
  results: SearchResult[]
}

export function initTjSearch(): void {
  document.querySelectorAll<HTMLElement>('[data-search]').forEach(initSearch)
}

function initSearch(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('[data-search-form]')
  const input = root.querySelector<HTMLInputElement>('[data-search-input]')
  const status = root.querySelector<HTMLElement>('[data-search-status]')
  const list = root.querySelector<HTMLUListElement>('[data-search-results]')
  if (!form || !input || !status || !list || form.dataset.searchInitialized === '1') return
  form.dataset.searchInitialized = '1'

  let timer: number | undefined
  let latest = 0

  function render(data: SearchResponse) {
    list!.textContent = ''
    for (const item of data.results || []) {
      const li = document.createElement('li')
      const link = document.createElement('a')
      link.href = item.url
      link.textContent = item.title
      const date = document.createElement('span')
      date.className = 'search-result-date'
      date.textContent = item.date
      li.append(link, date)
      list!.append(li)
    }
    list!.hidden = !data.total
    if (!data.total) status!.textContent = 'No posts match. Try fewer or different words.'
    else if (data.total > data.results.length) status!.textContent = `Showing ${data.results.length} of ${data.total} posts.`
    else status!.textContent = data.total === 1 ? '1 post' : `${data.total} posts`
  }

  function run() {
    const query = input!.value.trim()
    const request = ++latest
    if (!query) {
      list!.textContent = ''
      list!.hidden = true
      status!.textContent = ''
      return
    }
    status!.textContent = 'Searching…'
    fetch(`${TJ}/api/search?q=${encodeURIComponent(query)}&limit=30`, { headers: { Accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) throw new Error('Search failed')
        return response.json() as Promise<SearchResponse>
      })
      .then((data) => { if (request === latest) render(data) })
      .catch(() => { if (request === latest) status!.textContent = 'Search is unavailable right now. Try again in a moment.' })
  }

  input.addEventListener('input', () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(run, DEBOUNCE_MS)
  })
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    window.clearTimeout(timer)
    run()
  })
}
