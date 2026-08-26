import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const saves = await readFile(new URL('../src/saves.ts', import.meta.url), 'utf8')
const view = await readFile(new URL('../src/boards-view.ts', import.meta.url), 'utf8')
const css = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8')
const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8')
const header = await readFile(new URL('../src/tjheader.ts', import.meta.url), 'utf8')

test('saved-board writes have no automatic truncation or eviction path', () => {
  assert.doesNotMatch(saves, /MAX_BOARDS|\.slice\(MAX_BOARDS\)|oldest saves are dropped/)
  assert.match(saves, /writeSavedBoards\(localStorage, storageKey, all\)/)
  assert.match(saves, /storedSetIsWritable\(storageKey\)/)
  assert.match(saves, /Merge without eviction/)
})

test('saved documents use the Project-or-Scene union without flattening sequences', () => {
  assert.match(saves, /scene: BoardDocument/)
  assert.match(saves, /setDocumentAdapter\(getDocument: BoardDocumentAdapter\['getDocument'\], loadDocument: BoardDocumentAdapter\['loadDocument'\]\)/)
  assert.match(saves, /loadDocument\(document, \{ name, id: p\.id \?\? null \}\)/)
  assert.match(saves, /activateDocument\(documentId: string\)/)
  assert.match(saves, /removeDocument\(documentId: string\)/)
  assert.match(saves, /if \(!saved\.id\) \{[\s\S]*saved\.id = newId\(\)/)
  assert.match(main, /saves\.setDocumentAdapter\(\(\) => currentProject\(library\), loadSavedDocument\)/)
  assert.match(main, /const migrated = migrateProject\(document\)/)
  assert.match(main, /installProject\(project, preferredBoardId\)/)
  // an explicit board beats the remembered one, which beats board 0
  assert.match(main, /editingBoard = preferred >= 0 \? preferred : Math\.max\(0, storedBoardIndex\(library, project\)\)/)
  assert.match(main, /function saveProjectChanges\(project: Project = currentProject\(library\)\) \{\s*documentChangeGeneration \+= 1/)
  assert.match(saves, /projectDocuments\(\): SavedProjectDocument\[\]/)
  assert.match(saves, /persistProjectDocuments\(projects: readonly Project\[\]\): boolean/)
  assert.match(saves, /id: existing\?\.id \|\| newId\(\)/)
  assert.match(main, /reconcileLibraryProjectDocuments\(\{ seedMissing: !freshStarter \}\)[\s\S]*if \(!saves\.activateDocument\(library\.currentId\)\)/)
  assert.match(main, /if \(!freshStarter\) saves\.registerNew\(\)/)
  assert.match(main, /freshDeviceDestination\(library, freshStarter, remoteProjectIds\)/)
  // Snapshots and conflict copies serialize the adapter's full normalized document.
  assert.match(saves, /scene: this\.documentForSave\(\)/)
  const imported = saves.match(/importFile\(text: string\)[\s\S]*?\n  }\n\n  resetProjects/)?.[0] ?? ''
  assert.match(imported, /const normalized = tryNormalizeBoardDocument\(p\.scene\)/)
  assert.match(imported, /const rawDocument = JSON\.parse\(JSON\.stringify\(p\.scene\)\)/)
  assert.match(imported, /normalizeDocumentArrowLegends\(rawDocument, normalized\)/)
  assert.match(imported, /scene: storedDocument/)
  assert.match(imported, /const rowCollision = id \? Object\.values\(all\)\.find/)
  assert.match(imported, /id = newId\(\)/)
  assert.match(imported, /const projectCollision = Object\.values\(all\)\.some/)
  const exported = saves.match(/exportFile\(\): string[\s\S]*?\n  }\n\n  \/\*\* Merge/)?.[0] ?? ''
  assert.match(exported, /boards: personal/)
  assert.doesNotMatch(exported, /\.objects/)
  assert.doesNotMatch(saves.match(/function readAll[\s\S]*?\n}/)?.[0] ?? '', /normalizeBoardDocument/)
  assert.match(saves, /copyDocumentForConflict\(this\.documentForSave\(\), id\)/)
  assert.match(saves, /preserveDocumentFields\(this\.currentDocumentTemplate, current\)/)
  assert.match(saves, /this\.currentDocumentTemplate = template/)
})

test('all edit paths recompute policy from canonical entitlement', () => {
  // The saved-board limit follows paid access, so either product lifts it: the
  // one-time license and the Pro subscription both do.
  assert.match(saves, /hasPaidBoardAccess/)
  assert.doesNotMatch(saves, /localStorage.*(?:pro|entitlement)|searchParams.*pro/i)
  assert.match(saves, /editableBoardNames\(all, hasPaidBoardAccess\(\)\)/)
  assert.match(saves, /private autosaveNamed[\s\S]*editableBoardNames\(all, hasPaidBoardAccess\(\)\)\.has\(name\)/)
  // Pro is used only for owner-only invitation controls; saved-board policy
  // stays based on paid access.
  assert.match(saves, /const canInvite = isPro\(\)/)
  assert.match(saves, /Pro is needed to invite someone\. You can still remove access\./)
})

test('locked loads remain loadable but cannot flow into background autosave', () => {
  assert.match(saves, /this\.store\.loadScene/)
  assert.match(saves, /Read-only saved board/)
  assert.match(saves, /return this\.autosaveNamed\(this\.currentName, all\)/)
  assert.match(saves, /This saved board is read-only/)
  assert.match(saves, /exports only the stored copy/)
})

test('new-board flow preserves state unless save succeeds or discard is confirmed', () => {
  assert.match(main, /!saves\.autosaveCurrent\(\) && !confirm\(/)
  assert.match(main, /unsaved changes that could not be saved/)
  assert.match(main, /openNewProject\(scene\)/)
  assert.match(main, /saves\.registerNew\(\)/)
  assert.match(main, /if \(!saves\.activateDocument\(id\)\) \{[\s\S]*saves\.registerNew\(\)/)
  assert.match(main, /deleteProject: \(id\) => \{ saves\.removeDocument\(id\) \}/)
  assert.match(main, /const currentStillExists = library\.projects\.some/)
  const blankProject = main.match(/if \(kind === 'blank'\) \{[\s\S]*?\n  } else \{/)?.[0] ?? ''
  assert.match(blankProject, /scene\.objects = \[\]/)
  assert.match(blankProject, /scene\.match = \{ \.\.\.emptyMatch\(\), \.\.\.scene\.match, home: '', away: '', showTeams: false \}/)
  assert.match(blankProject, /teams\.resetTeams\(\[\]\)/)
  const startNew = saves.match(/private startNew[\s\S]*?\n  }/)?.[0] ?? ''
  assert.doesNotMatch(startNew, /nameInput\(\)\.value\s*=\s*''/)
})

test('shared rows show attribution and never expose deletion', () => {
  assert.match(saves, /Shared by @/)
  assert.match(saves, /\$\{!isShared \? `<button class="setItemAction danger"/)
  assert.match(saves, /all\[name\]\.access === 'shared'\) return/)
  assert.match(saves, /entry\.access !== 'shared'/)
  assert.match(saves, /A shared board cannot be replaced or deleted/)
  assert.match(saves, /filter\(\(\[, project\]\) => project\.access !== 'shared'\)/)
  assert.match(saves, /<dialog|document\.createElement\('dialog'\)/)
})

test('the share button owns copy links, invitations, and export', () => {
  // the menu builds itself from what the build can honour, so assert the
  // entries rather than fixed markup
  assert.match(main, /const shareMenu = document\.querySelector<HTMLElement>\('#shareMenu'\)!/)
  assert.match(main, /label: 'Copy link'/)
  assert.match(main, /A copy of this board, or of the whole project/)
  assert.match(main, /role="radiogroup" aria-label="What to copy"/)
  assert.match(main, /data-link-scope="board">This board/)
  assert.match(main, /data-link-scope="project">Whole project/)
  assert.match(main, /createBoardImportUrl\(boardLinkName, newProjectFromBoard\(source, boardLinkName\), boardLinkPreview\(\)\)/)
  assert.match(main, /createProjectImportUrl\(projectName, projectCopy\)/)
  assert.match(main, /The link expires after 24 hours\./)
  assert.match(main, /The link does not expire\./)
  assert.match(main, /function addSharedProject\(draft: AgentImportDraft, projectId: string \| null\)/)
  assert.match(main, /canCreateProject\(library, entitlements\.hasPaidBoardAccess\(\)\)/)
  assert.match(main, /appendProjectCopy\(project, source\)/)
  assert.match(main, /newProjectFromProjectCopy\(source, draft\.name\)/)
  assert.match(main, /filter\(row => row\.readOnly\)/)
  assert.match(main, /Add these boards to an existing project/)
  assert.match(main, /addProject: addSharedProject/)
  assert.match(main, /function boardLinkPreview\(/)
  assert.match(main, /label: 'Invite a person'/)
  assert.match(main, /label: 'Invite an agent'/)
  assert.match(main, /shareStep\('Invite an agent',[\s\S]*?makeAgentLink\(body\)/)
  assert.match(main, /saves\.currentAgentLink\(\)/)
  assert.match(main, /data-agent-link aria-label="Agent link"/)
  assert.match(main, /entry\.key !== 'username' && entry\.key !== 'board-link' && entry\.key !== 'agent'/)
  const currentAgentLink = saves.match(/async currentAgentLink\(\)[\s\S]*?\n  }/)?.[0] ?? ''
  assert.doesNotMatch(currentAgentLink, /this\.open\(\)/)
  assert.match(main, /label: 'Export/)
  // invitations are answered inside the share sheet rather than moving into Settings
  assert.match(main, /saves\.embedShareForm\(body\)/)
  assert.match(saves, /embedShareForm\(host: HTMLElement\)/)
  assert.doesNotMatch(main, /inviteCurrentByUsername!\(\)/)
  // every entry is listed, and the ones this account cannot reach say what
  // buys them and go to the page that sells it
  assert.match(main, /locked: pro \? undefined : \{ tag: 'Pro', toast: UPGRADE_TOAST \}/)
  assert.match(main, /const UPGRADE_TOAST = 'Go to settings to upgrade to a Pro subscription\.'/)
  assert.match(main, /if \(entry\.locked\) \{ showToast\(entry\.locked\.toast\); return \}/)
  assert.match(main, /setTag \$\{e\.locked\.tag === 'Pro' \? 'setTagPro' : 'setTagLicense'\}/)
  // every locked row is marked and answers; a preview build cannot mint a real
  // agent link however much Pro it grants, and says so instead of nothing
  assert.match(main, /tag: 'Board', toast: 'Agent links are issued only from board\.tacticsjournal\.com\.'/)
  assert.doesNotMatch(main, /locked\?\.trim\(\)/)
  assert.doesNotMatch(saves, /data-sv="share"/)
})

test('sharing can replace a local row id without deleting the foreign server row', () => {
  const reidentify = saves.match(/reidentifySavedBoard\(boardId: string\)[\s\S]*?\n  }/)?.[0] ?? ''
  assert.match(reidentify, /saved\.access === 'shared'/)
  assert.match(reidentify, /saved\.readOnly === true/)
  assert.match(reidentify, /newId\(\)/)
  assert.match(reidentify, /syncAccount: _previousAccount/)
  assert.match(reidentify, /writeAll\(next, this\.storageKey\)/)
  assert.doesNotMatch(reidentify, /recordTombstones/)
  assert.match(saves, /let shareId = board\.id/)
  assert.match(saves, /shareId = finalId/)
  assert.match(saves, /board_id: shareId/)
})

test('one row covers the three ways to name a person, and each carries a role', () => {
  assert.match(saves, /onPrepareShare: \(boardId: string\) => Promise<string>/)
  assert.match(saves, /this\.onPrepareShare\(shareId\)/)
  // email first: it is the only one that reaches somebody who has never heard
  // of Tactics Journal
  assert.match(saves, /\['email', 'Email'\], \['username', '@username'\], \['link', 'Copy link'\]/)
  assert.match(saves, /chooseWay\('email'\)/)
  // one question about what they may do, asked with the same control as the
  // ways above it, and answered whichever way is showing
  assert.match(saves, /\['write', 'Edit the project'\], \['read', 'Read only'\]/)
  assert.match(saves, /const role = \(\) => chosenRole/)
  // every request carries the chosen role, whichever way named the person
  assert.match(saves, /board_id: shareId, username, role: role\(\)/)
  assert.match(saves, /board_id: shareId, kind: 'email', email, role: role\(\)/)
  assert.match(saves, /board_id: shareId, kind: 'link', role: role\(\)/)
  // the link is copied where it is read: one press makes it and copies it,
  // and a link made for one permission never stands for another
  assert.match(saves, /const copyLink = async \(\) =>/)
  // one link field, wherever a link is handed over: the agent's and the
  // person's invitation are the same component
  assert.match(saves, /function linkField\(ariaLabel: string/)
  assert.match(saves, /\$\{linkField\('Agent link'\)\}/)
  assert.match(saves, /\$\{linkField\('Invitation link', 'Made when you copy it'\)\}/)
  assert.match(saves, /if \(next !== chosenRole\) forgetLink\(\)/)
  assert.match(saves, /submit\.hidden = next === 'link'/)
})

test('a refusal arrives in the words the server chose', () => {
  // the whole reason the old form was undiagnosable: it replaced every reason
  // with one sentence of its own
  assert.match(saves, /if \(!response\.ok\) throw new Error\(data\?\.error \|\| 'That did not work\.'\)/)
  assert.doesNotMatch(saves, /Could not share this board/)
  assert.match(saves, /error instanceof Error \? error\.message : 'That did not work\.'/)
})

test('an invitation link is read before it is spent, and never left in the address bar', () => {
  assert.match(main, /clean\.searchParams\.delete\('invite'\)/)
  assert.match(main, /window\.history\.replaceState\(null, '', clean\.toString\(\)\)/)
  // reading it is a GET and opens a local read-only preview; only accepting claims it
  assert.match(main, /\$\{boardInvitationUrl\(\)\}\?token=/)
  assert.match(main, /saves\.openInvitationPreview\(\{/)
  assert.match(saves, /access: 'shared',[\s\S]*?readOnly: true/)
  assert.match(main, /It is open read-only now, without a login\./)
  assert.match(main, /saves\.restoreInvitationPreview\(invitedBoardId\)/)
  assert.match(saves, /if \(all\[name\]\?\.readOnly === true\)/)
  assert.match(saves, /if \(currentExists && all\[this\.currentName!\]\?\.readOnly === true\)/)
  assert.match(main, /body: JSON\.stringify\(\{ token \}\)/)
  // signing in comes back holding the same invitation
  assert.match(main, /back\.searchParams\.set\('invite', token\)/)
})

test('a place on a shared project is claimed on a heartbeat and given back', () => {
  assert.match(main, /const PRESENCE_HEARTBEAT_MS = 30_000/)
  assert.match(main, /action: 'claim'/)
  assert.match(main, /action: 'release'/)
  // a closing tab cannot wait for fetch
  assert.match(main, /navigator\.sendBeacon\?\.\(boardPresenceUrl\(\)/)
  assert.match(main, /window\.addEventListener\('pagehide'/)
  // being refused a place is a read-only board, not a disconnection
  assert.match(main, /const crowded = response\.status === 409/)
})

test('a read-only shared board says so where it is listed', () => {
  assert.match(saves, /isCurrentReadOnly\(\): boolean/)
  assert.match(saves, /const readOnly = isShared && project\.readOnly === true/)
  assert.match(saves, /locked \|\| readOnly \? `<span class="saveReadOnly">/)
})

test('account changes scope sync state and ignore stale on-screen reconciliation', () => {
  assert.match(main, /account_binding/)
  assert.match(main, /syncStore = sync\.createLocalSyncStore\(accountBinding\)/)
  assert.match(main, /if \(passGeneration !== syncGeneration\) return/)
  assert.match(main, /resetBoardSession\(\)/)
  assert.match(main, /ensureBoardSession\(requestedBinding\)/)
  assert.match(main, /requestedGeneration !== syncGeneration/)
  assert.match(main, /liveChannel\.stop\(\)/)
  assert.match(header, /showAccountLoggedOut\(\)\s*announceSession\(\)/)
})

test('email-code sign-in loads the canonical account before board sync starts', () => {
  const visibleCodePath = header.match(/if \(mode === 'code'\) \{[\s\S]*?\n          return\n/)?.[0] ?? ''
  assert.match(visibleCodePath, /return loadCanonicalAccountSessionAfterSignIn\(\)/)
  assert.doesNotMatch(visibleCodePath, /setAuthenticatedEverywhere\(/)

  const canonicalLoad = header.match(/async function loadCanonicalAccountSessionAfterSignIn\(\) \{[\s\S]*?\n  }/)?.[0] ?? ''
  assert.match(canonicalLoad, /if \(accountSessionPromise\) await accountSessionPromise/)
  assert.match(canonicalLoad, /accountSessionData = null/)
  assert.match(canonicalLoad, /await fetchAccountSession\(\)/)
  assert.equal((header.match(/return loadCanonicalAccountSessionAfterSignIn\(\)/g) ?? []).length, 2)
})

test('free local scheduling receives whether the changed record is shared', () => {
  assert.match(saves, /onLocalChange: \(change\?: SavesLocalChange\)/)
  assert.match(saves, /this\.onLocalChange\(\{ shared: sharedChanged \}\)/)
  assert.match(main, /if \(authenticated && !entitlements\.isPro\(\) && !change\.shared\) return/)
  assert.match(main, /saves\.onLocalChange = \(change\) => \{\s*updatePresence\(\)\s*scheduleSync\(SYNC_DEBOUNCE, change \?\? \{ shared: false \}\)/)
})

test('rename and overwrite paths protect locked records and retain confirmation', () => {
  assert.match(saves, /all\[name\] && !editable\.has\(name\)/)
  assert.match(saves, /confirm\(`Overwrite saved board/)
  assert.match(saves, /delete next\[this\.currentName!\]/)
})

test('user-facing plan copy names every live offer exactly', () => {
  assert.match(main, /Keep three boards editable on this device; older boards stay available read-only/)
  assert.match(main, /Keep unlimited boards editable on this device/)
  assert.doesNotMatch(main, /board unlocks automatically|Pro syncs them automatically/)

  // The licence is on sale, so the board offers it instead of collecting an
  // email for a launch that already happened.
  assert.match(main, /buyButton\('Get License', 'license'\)/)
  // The origin is resolved once, so a preview build can point at the sandbox.
  assert.match(main, /LICENSE_MANAGE_URL = `\$\{TJ_ORIGIN\}\/settings\/`/)
  assert.doesNotMatch(main, /Join Waitlist|join the waitlist/i)

  // Pro has fixed monthly and yearly offers on sale.
  assert.match(main, /PRO_CHECKOUT_OPEN\s*=\s*true/)
  // Yearly leads, and the toggle is the only way to reach the monthly price.
  assert.match(main, /data-period="yearly" aria-pressed="true"/)
  assert.match(main, /data-period="monthly" aria-pressed="false"/)
  assert.match(main, /yearly \? '\$14\.99' : '\$19\.99'/)
  assert.match(main, /yearly \? 'Billed yearly at \$179\.88' : 'Billed every month'/)
  assert.match(main, /buyButton\('Get Pro', 'pro_monthly'\)/)
  assert.match(main, /buyButton\('Get Pro', 'pro_yearly'\)/)
  // No stale price survives anywhere on the License and Pro surface.
  const pricing = main.match(/data-pane="pro"[\s\S]*?function renderProCta\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.notEqual(pricing, '')
  assert.doesNotMatch(pricing, /\$59|\$99 |\$99 a|\$129/)
  assert.doesNotMatch(main, /Pro account access is not connected yet/)
})

test('plan copy assigns only built features to each plan', () => {
  // The paid features here have working gates and implementations. Do not
  // reintroduce the old vague branding claim.
  assert.doesNotMatch(main, /branding on exports/)
  assert.doesNotMatch(main, /Unlimited editable boards and cross-device sync/)
  assert.match(main, /Pro includes the Annual Board License\./)
  assert.match(main, /pay only the difference/)
  assert.match(main, /data-pro-save>Save [$]60/)
  assert.match(main, /Full refund within 14 days of your first payment or of an automatic yearly renewal/)
  assert.doesNotMatch(main, /Monthly renewals|service failure requires/i)
  // Detection was removed rather than left on the card as a promise.
  assert.doesNotMatch(main, /player detection/i)
  const lic = main.match(/proCardName">Annual Board License[\s\S]*?<\/ul>/)?.[0] ?? ''
  assert.match(lic, /Draw over a broadcast screenshot on the live board/)
  assert.doesNotMatch(lic, /Coming soon/)

  // The scoreboard and overlays are free, so they belong to the Free card and
  // must not be sold on the licence card. Cones are gated, so they belong to
  // the licence and must not appear under Free. Squad lookup is free too.
  const free = main.match(/proCardName">Free[\s\S]*?<\/div>\s*<div class="proCard proCardAccent"/)?.[0] ?? ''
  assert.match(free, /scoreboard and match overlays/)
  assert.match(free, /Load real squads and kit colors/)
  assert.doesNotMatch(free, /Cones/)
  // Pro includes the licence, and the card must say so.
  const pro = main.match(/proCardName">Pro[\s\S]*?<\/ul>/)?.[0] ?? ''
  assert.match(pro, /Everything in the Annual Board License/)
  assert.match(pro, /Begin on one device and continue on another with automatic board sync/)
  assert.match(pro, /See edits appear on your other devices and for people you invite/)
  assert.match(pro, /Invite a collaborator by @username to edit the project/)
  assert.match(pro, /Give ChatGPT, Claude, or another AI agent 24-hour access by link or MCP/)
  const license = main.match(/proCardName">Annual Board License[\s\S]*?<\/ul>/)?.[0] ?? ''
  assert.match(license, /cones/)
  assert.doesNotMatch(license, /scoreboard and match overlays/)
  assert.match(license, /live broadcast/)
  assert.match(license, /own backgrounds/)
  assert.match(license, /without a Tactics Journal mark/)
  assert.match(license, /Keep unlimited boards editable/)
  assert.match(license, /GIF or video/)
  assert.doesNotMatch(license, /Real squads/)
})

test('the board sells where the buyer already is', () => {
  // The board has no server, so Tactics Journal creates the checkout against
  // the signed-in account and Polar's overlay opens over the board. Buying
  // never navigates away from the board someone has open.
  assert.match(main, /startCheckout\(product, theme, /)
  // The button stops claiming to be opening a checkout once the money is taken.
  assert.match(main, /'Confirming purchase\.\.\.'/)
  assert.match(main, /data-buy="\$\{product\}"/)
  assert.match(main, /LICENSE_MANAGE_URL = `\$\{TJ_ORIGIN\}\/settings\/`/)
  // Nothing about a purchase is decided here: no price id, no amount, no tier.
  const cta = main.match(/function renderLicenseCta\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.doesNotMatch(cta, /pri_|pro_|amount|tier|cadence/)
  // Someone who already holds one is not sold another.
  assert.match(cta, /hasBoardLicense\(\)/)
  assert.match(cta, /isPro\(\)/)
})

test('screenshot import stays behind the paid background gates', () => {
  // The separate screenshot-import toolbar action was removed. A screenshot is
  // saved to the background shelf, and both doors to that shelf are paid: the
  // camera button only exists on a photographic board, and adding one needs
  // the licence.
  const liveButton = main.match(/function syncLiveButton\(\)[\s\S]*?\n}/)?.[0] ?? ''
  assert.match(liveButton, /pitchById\(store\.scene\.pitch\)\.live/)
  assert.match(main, /if \(!entitlements\.canPickPitch\(style\)\)/)
  assert.match(main, /if \(!entitlements\.canUploadBackground\(\)\)/)

  // Do not resurrect the old standalone import button or its entitlement
  // change handler; the canonical Live-pitch gate owns this entry point.
  assert.doesNotMatch(main, /id="importBtn"|data-top="import"|importer\.open\(\)/)
})

test('signing in is free, and Pro sells sync rather than the door to it', () => {
  const pro = main.match(/proCardName">Pro[\s\S]*?<\/ul>/)?.[0] ?? ''
  // Sign-in is how a licence holder claims and recovers what they bought, and
  // accounts are free everywhere else on tacticsjournal.com. Selling it as a
  // Pro feature would lock a paying licence holder out of their own purchase.
  assert.doesNotMatch(pro, /Sign in/i)
  assert.match(pro, /automatic board sync/)
})

test('the Pro launch path will upgrade without charging twice', () => {
  const cta = main.match(/function renderProCta\(\)[\s\S]*?\n}/)?.[0] ?? ''
  // A subscriber is not sold what they already have.
  assert.match(cta, /entitlements\.isPro\(\)/)
  // Every Pro button reads the same, whatever the visitor already holds.
  assert.match(cta, /buyButton\('Get Pro', 'pro_yearly'\)/)
  assert.match(cta, /'pro_monthly'/)
  assert.match(cta, /'pro_yearly'/)
  // The board contains no provider product or price identifiers and sends no
  // amount, tier, or cadence in the request body.
  assert.doesNotMatch(cta, /pri_|product_id|price_id|amount|tier|cadence/)
  assert.match(main, /Pro includes the Annual Board License\./)
})

test('a board draws the pieces the board draws, from the board’s own art', () => {
  // the ball is the ball everywhere it is drawn; a circle with a pentagon in it
  // is a drawing of the ball, which is a different thing
  assert.doesNotMatch(saves, /const panel = Array\.from\(\{ length: 5 \}/)
  assert.match(saves, /import \{ ballSrc, coneSrc, goalFullSrc, goalSmallSrc, CONE_ASPECT, GOAL_ASPECT \} from '\.\/board-art'/)
  for (const piece of ['ART.ball, ballSrc', 'ART.cone, coneSrc', 'assetRef(String(o.assetId)), asset.src']) {
    assert.ok(saves.includes(piece), `${piece} is drawn from the art the board uses`)
  }
  // the pieces halve on a two-pitch board, the way the board halves them
  assert.match(saves, /function iconScale\(scene: Scene \| undefined\): number/)
})

test('the player points at one copy of each picture rather than writing it per frame', () => {
  // an SVG <image> never paints in the frame it is written, even with the bytes
  // in hand, so a piece rewritten sixty times a second lags the shapes beside it
  assert.match(saves, /art\?: 'draw' \| 'point'/)
  assert.match(saves, /const refs = opts\.art === 'point'/)
  assert.match(saves, /refs\s*\n\s*\? `<use\$\{turn\(o\)\} href="#\$\{ref\}"/)
  assert.match(saves, /export function boardArtDefs\(scenes: \(Scene \| undefined\)\[\]\): string/)
  // one symbol per picture, whatever draws it, and none for art nothing draws
  assert.match(saves, /const seen = new Set<string>\(\)/)
  assert.match(saves, /if \(objs\.some\(o => o\.type === 'ball'\)\) art\.push/)
})

test('the player fetches every picture it will draw when it opens', () => {
  // a picture inside a <symbol> nothing points at yet is not fetched, so a cone
  // that first appears on board two starts downloading mid-move and lands late
  assert.match(saves, /export function boardArt\(scenes: \(Scene \| undefined\)\[\]\): \{ id: string, src: string, aspect: number \}\[\]/)
  assert.match(saves, /export function boardArtDefs[\s\S]{0,200}boardArt\(scenes\)\.map/)
  assert.match(view, /boardArt\(scenes\)\.map\(a => a\.src\)/)
  assert.match(view, /for \(const src of pictures\)[\s\S]{0,220}img\.decode\?\.\(\)/)
})

test('the player keeps the shapes it has drawn instead of rebuilding them', () => {
  // an <image> is never painted in the frame it is created, so a piece rebuilt
  // every frame is always a frame from appearing — and on a slow device it
  // waits for the movement to stop
  assert.match(view, /const paintShapes = \(markup: string\) => \{/)
  assert.match(view, /paintShapes\(sceneShapesSvg\(frame\.scene/)
  assert.doesNotMatch(view, /shapes\.innerHTML = sceneShapesSvg/)
  assert.match(view, /for \(let i = 0; i < next\.length; i\+\+\) syncAttributes\(live\[i\], next\[i\]\)/)
  assert.match(view, /function syncAttributes\(live: Element, next: Element\): void/)
})

test('the player runs the board to the edges and starts at the top of the screen', () => {
  // a pitch is wider than a phone is, so width spent on margins is board the
  // reader does not get; once it reaches full width, unused height belongs
  // below the board rather than being split above and below it
  assert.match(view, /const width = vv\?\.width \?\? window\.innerWidth/)
  assert.doesNotMatch(view, /COLUMN_W/)
  assert.match(view, /const height = \(vv\?\.height \?\? window\.innerHeight\) - chrome$/m)
  assert.doesNotMatch(css, /\.seqPlayer__wrap \{[\s\S]{0,400}padding:/)
  assert.match(css, /\.seqPlayer__board \{[\s\S]{0,240}place-self: start center;/)
})

test('the note band stays under the board and the board is fitted around it', () => {
  // a band laid over the pitch covers the part most likely to be drawn on, and
  // a board fitted without reserving the band runs off the bottom of the screen
  assert.doesNotMatch(view, /is-noteOver/)
  assert.doesNotMatch(css, /is-noteOver/)
  assert.match(css, /\.seqPlayer__note \{\s*position: relative;/)
  // the hidden measure gets the intended board width even on the first frame,
  // then the band's height is taken out before the scale is chosen
  assert.match(view, /measure\.style\.width = `\$\{Math\.max\(1, width\)\}px`/)
  assert.match(view, /const stageH = \(h: number\) => Math\.max\(1, fit\.height - h\)/)
  assert.match(view, /const fitK = \(\) => Math\.min\(fit\.width \/ v\.w, stageH\(noteH\) \/ v\.h, 2\.1\)/)
  // the note receives the height a full-width board cannot use. Two passes
  // remain because the band's text can wrap differently at the fitted width.
  assert.match(view, /const spare = Math\.max\(0, fit\.height - Math\.round\(v\.h \* fullK\)\)/)
  assert.match(view, /const free = Math\.max\(0, Math\.floor\(spare\)\)/)
  assert.match(view, /return \{ cap: Math\.max\(minimum, free\), fill: free >= minimum \? free : 0 \}/)
  assert.match(view, /noteH = hasProjectNotes \? Math\.max\(tallest, fill\) : 0/)
  assert.match(view, /measureBand\(fullW, cap, fill\)/)
  assert.match(view, /if \(!bandFor\.startsWith\(`\$\{w\}:`\)\) \{\s*measureBand\(w, cap, fill\)\s*k = fitK\(\)\s*w = Math\.round\(v\.w \* k\)\s*\}/)
  assert.match(view, /stage\.style\.width = `\$\{w\}px`/)
})

test('the board note keeps its Markdown heading', () => {
  assert.match(main, /board\.setNote\(note\)/)
  assert.doesNotMatch(main, /board\.setNote\(noteBody\(note\)\)/)
  assert.match(view, /renderMarkdown\(project\.boards\[index\]\.note\)/)
})

test('the open project and its board survive a refresh', () => {
  // navigation state lives on Library, never on a synced Project document
  assert.match(main, /let editingBoard = Math\.max\(0, storedBoardIndex\(library, currentProject\(library\)\)\)/)
  const startup = main.match(/let editingBoard = Math[\s\S]*?saves\.activateDocument\(library\.currentId\)/)?.[0] ?? ''
  assert.ok(startup, 'startup restores the board before activating the document')
  const open = main.match(/function openLibraryProject\(id: string, preferredBoardId\?: string\)[\s\S]*?\n}/)?.[0] ?? ''
  // the outgoing project keeps its board and the incoming one gets its own back
  assert.match(open, /rememberBoard\(library, library\.currentId, currentProject\(library\)\.boards\[editingBoard\]\?\.id\)/)
  assert.match(open, /editingBoard = Math\.max\(0, storedBoardIndex\(library, currentProject\(library\)\)\)/)
  const openBoard = main.match(/openBoard: \(index\) => \{[\s\S]*?\n  \},/)?.[0] ?? ''
  assert.match(openBoard, /rememberBoard\(library, project\.id, board\.id\)/)
  assert.match(openBoard, /saveLibrary\(library\)/)
})
