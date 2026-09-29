import type { RuntimeEvent } from '@wiwana/protocol'
import { randomUUID } from 'node:crypto'

export interface RuntimeSessionState {
  id: string
  taskId: string
  type: string
  prompt: string
  capabilityPacks: string[]
  events: RuntimeEvent[]
  listeners: Set<(event: RuntimeEvent) => void>
  cancelled: boolean
  finished: boolean
}

export class SessionRegistry {
  private sessions = new Map<string, RuntimeSessionState>()

  create(input: { taskId: string; type: string; prompt: string; capabilityPacks: string[] }): RuntimeSessionState {
    const session: RuntimeSessionState = {
      id: randomUUID(),
      taskId: input.taskId,
      type: input.type,
      prompt: input.prompt,
      capabilityPacks: input.capabilityPacks,
      events: [],
      listeners: new Set(),
      cancelled: false,
      finished: false,
    }
    this.sessions.set(session.id, session)
    return session
  }

  get(id: string): RuntimeSessionState | null {
    return this.sessions.get(id) ?? null
  }

  list(): RuntimeSessionState[] {
    return [...this.sessions.values()]
  }

  emit(session: RuntimeSessionState, event: RuntimeEvent): void {
    session.events.push(event)
    if (event.type === 'done' || event.type === 'error') session.finished = true
    for (const listener of session.listeners) listener(event)
  }

  subscribe(session: RuntimeSessionState, listener: (event: RuntimeEvent) => void): () => void {
    session.listeners.add(listener)
    return () => session.listeners.delete(listener)
  }
}
