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
  toolbar: HTMLElement
  extensions?: readonly OfficialExtension[]
}

export class OfficialExtensions {
  private readonly extensions: readonly OfficialExtension[]
  private readonly host: OfficialExtensionHost
  private readonly toolbar: HTMLElement
  private readonly running = new Map<string, OfficialExtensionInstance>()
  private state: OfficialExtensionState

  constructor(options: Options) {
    this.extensions = options.extensions || OFFICIAL_EXTENSIONS
    this.host = options.host
    this.toolbar = options.toolbar
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
    this.renderToolbar()
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
    this.renderToolbar()
  }

  private renderToolbar(): void {
    for (const el of Array.from(this.toolbar.querySelectorAll(`[${TOOLBAR_ACTION_ATTR}]`))) el.remove()
    for (const extension of this.extensions) {
      const instance = this.running.get(extension.id)
      for (const button of instance?.toolbar || []) {
        this.toolbar.appendChild(this.mountButton(extension, button))
      }
    }
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
