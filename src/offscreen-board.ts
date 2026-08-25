import { Board, type ToolDefaults } from './board'
import { Store } from './store'

/** A private renderer that never changes the editor or its undo history. */
export class OffscreenBoard {
  readonly store = new Store({ persist: false })
  readonly board: Board
  private host: HTMLDivElement

  constructor(defaults: ToolDefaults, resolveBackground?: (id: string) => Promise<string | null>) {
    this.host = document.createElement('div')
    this.host.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:618px;pointer-events:none'
    document.body.appendChild(this.host)
    const stage = document.createElement('div')
    stage.style.cssText = 'position:absolute;inset:0'
    this.host.appendChild(stage)
    this.board = new Board(this.store, stage, defaults)
    if (resolveBackground) this.board.setBackgroundResolver(resolveBackground)
  }

  destroy(): void { this.host.remove() }
}
