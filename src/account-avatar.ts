/**
 * The header account control shows the signed-in reader's own profile picture
 * in place of the outline account icon, matching tacticsjournal.com.
 *
 * The picture comes from the `avatar_url` field of the account session
 * snapshot the header already fetches - there is no second request - and it is
 * purely decorative: the control keeps its "Account" label and still opens the
 * account panel.
 */

export function profileImageUrl(data: any, accountOrigin: string): string {
  const raw = data && data.authenticated ? String(data.avatar_url || '').trim() : ''
  // The shared placeholder is not a picture of anyone, so it counts as having
  // no profile image and the outline icon stays.
  if (!raw || raw.indexOf('default-avatar') !== -1) return ''
  try {
    const url = new URL(raw, accountOrigin)
    return url.protocol === 'https:' ? url.href : ''
  } catch {
    return ''
  }
}

export interface AccountAvatar {
  update(data: any): void
}

export function createAccountAvatar(toggle: any, accountOrigin: string, doc: any = typeof document === 'undefined' ? null : document): AccountAvatar {
  let img: any = null
  let shownUrl = ''

  function clear() {
    if (img && img.parentNode) img.parentNode.removeChild(img)
    img = null
    if (toggle) toggle.classList.remove('has-avatar')
  }

  // The image is only shown once it has decoded, so a slow or failed avatar
  // leaves the outline icon in place instead of a broken image.
  function update(data: any) {
    if (!toggle || !doc) return
    const url = profileImageUrl(data, accountOrigin)
    if (url === shownUrl) return
    shownUrl = url
    if (!url) { clear(); return }
    const next = doc.createElement('img')
    next.className = 'site-action-avatar'
    next.alt = ''
    next.setAttribute('aria-hidden', 'true')
    next.width = 24
    next.height = 24
    next.addEventListener('load', () => {
      if (shownUrl !== url) return
      clear()
      img = next
      toggle.appendChild(next)
      toggle.classList.add('has-avatar')
    })
    next.addEventListener('error', () => {
      if (shownUrl !== url) return
      shownUrl = ''
      clear()
    })
    next.src = url
  }

  return { update }
}
