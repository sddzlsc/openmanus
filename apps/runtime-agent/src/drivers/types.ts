import type { RuntimeEvent } from '@wiwana/protocol'
import type { RuntimeSessionState } from '../session.js'

export interface DriverContext {
  emit(event: RuntimeEvent): void
  session: RuntimeSessionState
  workspace: string
  capabilitiesRoot: string
}

export interface RuntimeDriver {
  readonly kind: 'dsh' | 'local'
  start(context: DriverContext): Promise<void>
  send(context: DriverContext, text: string): Promise<void>
  cancel(context: DriverContext): Promise<void>
}
