import type { Automation } from '@wiwana/protocol'
import { describeCron, nextRun } from './cron.js'
import { createTaskForUser, type CreateTaskDeps } from './taskFactory.js'

export interface AutomationSchedulerDeps extends CreateTaskDeps {
  logger?: { info: (message: string, meta?: unknown) => void; warn: (message: string, meta?: unknown) => void }
}

/**
 * Turns due automations into tasks. Scheduling is intentionally dumb: the
 * control plane owns `next_run_at` in the database, so a restart never loses or
 * double-fires a job — the row is only advanced after the task is created.
 */
export class AutomationScheduler {
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly deps: AutomationSchedulerDeps,
    private readonly intervalMs = 30_000,
  ) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      void this.tick().catch((error) => {
        this.deps.logger?.warn('automation tick failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      })
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Runs every due schedule automation once; returns the number of tasks created. */
  async tick(now = new Date()): Promise<number> {
    const due = await this.deps.store.listDueAutomations(now)
    let created = 0
    for (const automation of due) {
      try {
        await this.fire(automation, now)
        created += 1
      } catch (error) {
        this.deps.logger?.warn('automation failed to start', {
          automationId: automation.id,
          error: error instanceof Error ? error.message : String(error),
        })
        // Advance anyway so one broken automation cannot block the scheduler.
        await this.deps.store.updateAutomationRun(automation.id, new Date().toISOString(), this.nextFrom(automation, now))
      }
    }
    return created
  }

  async fire(automation: Automation, now = new Date()): Promise<void> {
    await createTaskForUser(this.deps, {
      userId: automation.userId,
      type: 'office',
      prompt: automation.actionPrompt,
      title: automation.name,
      projectId: automation.projectId,
      origin: 'automation',
    })
    await this.deps.store.updateAutomationRun(
      automation.id,
      new Date().toISOString(),
      this.nextFrom(automation, now),
    )
  }

  private nextFrom(automation: Automation, now: Date): string | null {
    if (automation.trigger.kind !== 'schedule') return null
    try {
      return nextRun(automation.trigger.cron, automation.trigger.timezone, now).toISOString()
    } catch (error) {
      this.deps.logger?.warn('cannot compute next run', {
        automationId: automation.id,
        error: error instanceof Error ? error.message : String(error),
      })
      return null
    }
  }
}

/** Shared by the API when creating or re-enabling an automation. */
export function initialNextRun(
  trigger: Automation['trigger'],
  now = new Date(),
): string | null {
  if (trigger.kind !== 'schedule') return null
  try {
    return nextRun(trigger.cron, trigger.timezone, now).toISOString()
  } catch {
    return null
  }
}

export { describeCron }
