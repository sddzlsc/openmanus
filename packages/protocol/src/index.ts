/**
 * Shared product protocol for the Wiwana agent platform.
 *
 * This package is the single source of truth for:
 *  - domain entities persisted by the control plane
 *  - public HTTP API request/response payloads
 *  - the task event stream consumed by the web app (SSE)
 *  - the runtime-agent protocol spoken inside sandbox containers
 */

export * from './domain.js'
export * from './api.js'
export * from './events.js'
export * from './runtime.js'
