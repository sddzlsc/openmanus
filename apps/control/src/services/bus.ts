import type { TaskEvent } from '@wiwana/protocol'

/** In-process fan-out from the task runner to every connected SSE client. */
export class TaskEventBus {
  private listeners = new Map<string, Set<(event: TaskEvent) => void>>()

  subscribe(taskId: string, listener: (event: TaskEvent) => void): () => void {
    const set = this.listeners.get(taskId) ?? new Set()
    set.add(listener)
    this.listeners.set(taskId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) this.listeners.delete(taskId)
    }
  }

  publish(taskId: string, event: TaskEvent): void {
    for (const listener of this.listeners.get(taskId) ?? []) listener(event)
  }
}
