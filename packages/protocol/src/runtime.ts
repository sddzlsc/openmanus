import type { ArtifactKind, TaskStatus } from './domain.js'

/**
 * Protocol spoken between the control plane and the runtime agent that runs
 * inside every sandbox container. The runtime agent owns the dsh process and
 * never exposes it directly: the control plane only speaks this contract.
 */

export interface RuntimeStartSessionRequest {
  taskId: string
  type: string
  prompt: string
  /** Capability pack ids selected by the control plane. */
  capabilityPacks: string[]
  /** Hard limits enforced by the runtime agent (defense in depth). */
  limits: {
    maxSteps: number
    maxTokens: number
  }
}

export interface RuntimeSessionHandle {
  sessionId: string
}

export interface RuntimeSendMessageRequest {
  text: string
}

export type RuntimeEvent =
  | { type: 'status'; status: TaskStatus; progress: number; note?: string }
  | { type: 'thought'; text: string }
  | { type: 'tool'; name: string; summary: string; status: 'started' | 'finished' | 'failed' }
  | { type: 'terminal'; text: string }
  | { type: 'screenshot'; dataUrl: string; caption?: string }
  | { type: 'usage'; tokens: number; images?: number; videos?: number }
  | { type: 'artifact'; path: string; kind: ArtifactKind; name: string; mime: string }
  | { type: 'message'; role: 'agent' | 'system'; text: string }
  | { type: 'error'; message: string; retryable: boolean }
  | { type: 'done'; summary: string }

export interface RuntimeHealth {
  ok: boolean
  version: string
  /** Which driver is actually executing tasks in this sandbox. */
  driver: 'dsh' | 'local'
  dsh: { available: boolean; profile: string | null; binary: string | null }
  browser: { available: boolean }
}
