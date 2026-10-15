/* Runs bundled extensions and owns the controls they add to the toolbar.
 * Project extensions do not use this manager. They remain in the sandboxed
 * self-hosted runtime. */

import { OFFICIAL_EXTENSIONS } from './registry.ts'
import {
  isOfficialExtensionEnabled,
  loadOfficialExtensionState,
  saveOfficialExtensionState,
  setOfficialExtensionEnabled,
  type OfficialExtensionState,
} from './state.ts'
import {
  officialExtensionInfo,
  type OfficialExtension,
  type OfficialExtensionHost,
  type OfficialExtensionInfo,
  type OfficialExtensionInstance,
  type OfficialToolbarButton,
} from './types.ts'

export const TOOLBAR_ACTION_ATTR = 'data-ext-action'

type Options = {
  host: OfficialExtensionHost
  /** Called whenever the set of live toolbar controls changes. */
  onToolbarChange?: () => void
  extensions?: readonly OfficialExtension[]
}

/** One live control an extension is offering the bar. */
export type OfficialToolbarEntry = {
  /** Stable bar id: `ext:<extension>:<button>`. */
  key: string
  extensionId: string
  extensionName: string
  label: string
}

export function officialToolbarKey(extensionId: string, buttonId: string): string {
  return `ext:${extensionId}:${buttonId}`
}

export class OfficialExtensions {
  private readonly extensions: readonly OfficialExtension[]
  private readonly host: OfficialExtensionHost
  private readonly onToolbarChange: () => void
  private readonly running = new Map<string, OfficialExtensionInstance>()
  private readonly described = new Map<string, readonly OfficialToolbarButton[]>()
  private state: OfficialExtensionState

  constructor(options: Options) {
    this.extensions = options.extensions || OFFICIAL_EXTENSIONS
    this.host = options.host
    this.onToolbarChange = options.onToolbarChange || (() => {})
    this.state = loadOfficialExtensionState(this.ids())
  }

  private ids(): string[] { return this.extensions.map(extension => extension.id) }

  list(): OfficialExtensionInfo[] { return this.extensions.map(officialExtensionInfo) }

  info(id: string): OfficialExtensionInfo | null {
    const extension = this.extensions.find(item => item.id === id)
    return extension ? officialExtensionInfo(extension) : null
  }

  isEnabled(id: string): boolean { return isOfficialExtensionEnabled(this.state, id) }

  start(): void { this.sync() }

  setEnabled(id: string, enabled: boolean): void {
    const next = setOfficialExtensionEnabled(this.state, id, enabled, this.ids())
    if (next.enabled.join('\0') === this.state.enabled.join('\0')) return
    this.state = next
    saveOfficialExtensionState(this.state, this.ids())
    this.sync()
  }

  stop(): void {
    for (const [id, instance] of this.running) {
      this.running.delete(id)
      safely(() => instance.deactivate())
    }
    this.onToolbarChange()
  }

  /**
   * Every control a bundled extension could offer, running or not, so Tool
   * settings can list one that is switched off without starting it.
   */
  toolbarEntries(): OfficialToolbarEntry[] {
    const entries: OfficialToolbarEntry[] = []
    for (const extension of this.extensions) {
      for (const button of this.buttonsFor(extension)) {
        entries.push({
          key: officialToolbarKey(extension.id, button.id),
          extensionId: extension.id,
          extensionName: extension.name,
          label: button.label,
        })
      }
    }
    return entries
  }

  /**
   * A ready-to-place button for one bar id, or null when the extension behind
   * it is switched off. The bar keeps the id either way, so turning the
   * extension back on puts the control back where it was.
   */
  createToolbarButton(key: string): HTMLButtonElement | null {
    for (const extension of this.extensions) {
      const instance = this.running.get(extension.id)
      for (const button of instance?.toolbar || []) {
        if (officialToolbarKey(extension.id, button.id) === key) return this.mountButton(extension, button)
      }
    }
    return null
  }

  /**
   * What an extension offers without running it. Activating asks the host for
   * real view changes, so a switched-off extension is described by starting it
   * and standing it straight back down.
   */
  private buttonsFor(extension: OfficialExtension): readonly OfficialToolbarButton[] {
    const running = this.running.get(extension.id)
    if (running) return running.toolbar || []
    const cached = this.described.get(extension.id)
    if (cached) return cached
    const probe = safely(() => extension.activate(this.host))
    const buttons = probe?.toolbar ? [...probe.toolbar] : []
    if (probe) safely(() => probe.deactivate())
    this.described.set(extension.id, buttons)
    return buttons
  }

  private sync(): void {
    for (const extension of this.extensions) {
      const on = this.isEnabled(extension.id)
      const instance = this.running.get(extension.id)
      if (on && !instance) {
        const started = safely(() => extension.activate(this.host))
        if (started) this.running.set(extension.id, started)
      } else if (!on && instance) {
        this.running.delete(extension.id)
        safely(() => instance.deactivate())
      }
    }
    this.onToolbarChange()
  }

  private mountButton(extension: OfficialExtension, button: OfficialToolbarButton): HTMLButtonElement {
    const el = document.createElement('button')
    el.type = 'button'
    el.className = 'iconBtn extBtn'
    el.setAttribute(TOOLBAR_ACTION_ATTR, `${extension.id}:${button.id}`)
    el.innerHTML = button.icon
    const paint = () => {
      const pressed = button.pressed ? button.pressed() : false
      const label = pressed && button.pressedLabel ? button.pressedLabel : button.label
      el.setAttribute('aria-label', label)
      el.title = label
      if (button.pressed) {
        el.setAttribute('aria-pressed', String(pressed))
        el.classList.toggle('active', pressed)
      }
    }
    paint()
    el.addEventListener('click', () => { safely(() => button.select()); paint() })
    return el
  }
}

function safely<T>(run: () => T): T | null {
  try { return run() } catch (error) {
    console.error('Official extension failed', error)
    return null
  }
}
