import type { Artifact, TaskStatus } from './domain.js'

/**
 * Task stream events. Delivered over SSE at `GET /api/tasks/:id/stream`
 * and replayed from the persisted log on reconnect.
 */
export type TaskEvent =
  | { type: 'status'; seq: number; at: string; status: TaskStatus; progress: number; note?: string }
  | { type: 'thought'; seq: number; at: string; text: string }
  | { type: 'tool'; seq: number; at: string; name: string; summary: string; status: 'started' | 'finished' | 'failed' }
  | { type: 'message'; seq: number; at: string; role: 'user' | 'agent' | 'system'; text: string }
  | { type: 'artifact'; seq: number; at: string; artifact: Artifact }
  | { type: 'terminal'; seq: number; at: string; text: string }
  | { type: 'screenshot'; seq: number; at: string; dataUrl: string; caption?: string }
  | { type: 'usage'; seq: number; at: string; tokens: number; images?: number; videos?: number }
  | { type: 'error'; seq: number; at: string; message: string; retryable: boolean }
  | { type: 'done'; seq: number; at: string; summary: string }

export type TaskStreamEventName = TaskEvent['type']

export interface TaskEventEnvelope {
  taskId: string
  seq: number
  event: TaskEvent
}
