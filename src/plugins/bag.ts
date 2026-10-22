export type Dispose = () => void

/** An ordered list of contributions; adding returns the function that takes the item out again. */
export class Bag<T> {
  private readonly items: T[] = []
  private readonly listeners = new Set<() => void>()

  add(item: T): Dispose {
    this.items.push(item)
    this.emit()
    let done = false
    return () => {
      if (done) return
      done = true
      const index = this.items.indexOf(item)
      if (index >= 0) this.items.splice(index, 1)
      this.emit()
    }
  }

  list(): readonly T[] {
    return this.items
  }

  subscribe(listener: () => void): Dispose {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
