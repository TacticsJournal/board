import re

import urllib.request
req = urllib.request.Request('https://tacticsjournal.com/style.css', headers={'User-Agent': 'tj-panels-sync'})
css = urllib.request.urlopen(req).read().decode('utf-8')

# tokenise top-level blocks (handles one level of @media nesting)
def blocks(text):
    out, i, n = [], 0, len(text)
    while i < n:
        m = re.search(r'[^\s]', text[i:])
        if not m: break
        i += m.start()
        brace = text.find('{', i)
        if brace < 0: break
        sel = text[i:brace].strip()
        depth, j = 1, brace + 1
        while j < n and depth:
            if text[j] == '{': depth += 1
            elif text[j] == '}': depth -= 1
            j += 1
        out.append((sel, text[brace+1:j-1]))
        i = j
    return out

PREFIXES = (
    '.site-overlay-panel', '.site-search-panel', '.site-account-panel', '.site-search-content',
    '.site-panel-animate', '.search-', '.signin-', '.research-login-form', '.research-gate',
    '.account-', '.site-account-', '.hub-feed', '.sr-only', '.post-title', '.notif-',
)
BODY_STATES = ('site-panel-open', 'site-account-open', 'site-scroll-locked')

def keep_selector(sel):
    # split compound selector list; keep if ANY part hits the allowlist
    for part in sel.split(','):
        p = part.strip()
        if any(tok in p for tok in PREFIXES): return True
        if 'data-inline-open' in p: return True
        if any(f'.{s}' in p for s in BODY_STATES): return True
    return False

kept = []
for sel, body in blocks(css):
    if sel.startswith('@media'):
        inner = [(s, b) for s, b in blocks(body) if keep_selector(s)]
        if inner:
            kept.append(sel + ' {\n' + '\n'.join(f'{s} {{{b}}}' for s, b in inner) + '\n}')
    elif sel.startswith('@'):
        continue
    elif keep_selector(sel):
        kept.append(f'{sel} {{{body}}}')

# variable sets, scoped to the panels so the board theme is untouched.
# The site declares each set more than once - a base block and a later tuning
# block that retunes a handful of values - so merge them in source order
# instead of letting one block win and drop the rest.
def merge_vars(selectors):
    merged = {}
    for sel, body in blocks(css):
        if sel not in selectors: continue
        for decl in body.split(';'):
            decl = decl.strip()
            if not decl.startswith('--'): continue
            name, _, value = decl.partition(':')
            merged[name.strip()] = value.strip()
    return ';\n  '.join(f'{k}: {v}' for k, v in merged.items())

root_vars = merge_vars({':root'})
dark_vars = merge_vars({'html[data-theme-resolved=dark]', 'html[data-theme-resolved="dark"]'})

header = '''/* Extracted from https://tacticsjournal.com/style.css (compiled) so the
   header search/account overlay panels render exactly like the site.
   Regenerate with scripts/sync-tj-panels.py after site CSS changes.
   TJ design variables are scoped to the panels; the board theme keeps
   its own :root values. */
#site-search-panel, #site-account-panel, .site-menu-theme {
  %s
}
html[data-theme-resolved="dark"] #site-search-panel,
html[data-theme-resolved="dark"] #site-account-panel,
html[data-theme-resolved="dark"] .site-menu-theme {
  %s;
}
/* The board sets a platform font stack on body for its own chrome. Everything
   ported from the site inherits the site's stack instead, or the header and
   panels render a typeface the site never uses. */
.site-header, .site-menu, #site-search-panel, #site-account-panel {
  font-family: Helvetica, Arial, sans-serif;
  letter-spacing: normal;
}
''' % (root_vars, dark_vars)

open('src/tj-panels.css', 'w').write(header + '\n'.join(kept) + '\n')
print('rules kept:', len(kept), '| bytes:', len(header + chr(10).join(kept)))
