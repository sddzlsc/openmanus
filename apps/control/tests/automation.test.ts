import { describe, expect, it } from 'vitest'
import { describeCron, matches, nextRun, parseCron, localParts, zonedTimeToUtc } from '../src/services/cron.js'
import { AutomationScheduler } from '../src/services/automationScheduler.js'
import { MemoryStore } from '../src/store/memory.js'
import { loadConfig } from '../src/config.js'

const TZ = 'Asia/Shanghai'

describe('cron', () => {
  it('computes the next daily run in the automation timezone', () => {
    // 2026-03-01T23:30:00Z == 2026-03-02 07:30 in Asia/Shanghai
    const from = new Date('2026-03-01T23:30:00Z')
    const next = nextRun('0 9 * * *', TZ, from)
    expect(next.toISOString()).toBe('2026-03-02T01:00:00.000Z') // 09:00 +08:00
  })

  it('handles every-N-minutes and weekday expressions', () => {
    const from = new Date('2026-03-02T00:07:00Z') // 08:07 +08:00, Monday
    expect(nextRun('*/15 * * * *', TZ, from).toISOString()).toBe('2026-03-02T00:15:00.000Z')
    // 周一 10:00
    expect(nextRun('0 10 * * 1', TZ, from).toISOString()).toBe('2026-03-02T02:00:00.000Z')
  })

  it('supports shorthands and rejects malformed input', () => {
    expect(parseCron('@daily').hours.has(0)).toBe(true)
    expect(describeCron('*/30 * * * *')).toBe('每 30 分钟')
    expect(() => parseCron('0 9 * *')).toThrow()
    expect(() => parseCron('99 * * * *')).toThrow()
  })

  it('round-trips wall-clock times across the timezone boundary', () => {
    const instant = zonedTimeToUtc(2026, 3, 2, 9, 0, TZ)
    const parts = localParts(instant, TZ)
    expect([parts.year, parts.month, parts.day, parts.hour, parts.minute]).toEqual([2026, 3, 2, 9, 0])
    expect(matches(parseCron('0 9 * * *'), parts)).toBe(true)
  })
})

describe('automation scheduler', () => {
  it('turns a due automation into a task and advances the schedule', async () => {
    const store = new MemoryStore()
    const config = loadConfig({ WORKSPACE_ROOT: '/tmp/wiwana-automation-test' } as NodeJS.ProcessEnv)
    const user = await store.createUser({ phone: '13800001111' })
    const projectId = 'prj_automation_test'
    await store.createProject({
      id: projectId,
      userId: user.id,
      name: '自动周报',
      workspaceKey: 'ws_prj_automation_test',
      environment: 'task-sandbox',
      previewDomain: null,
    })
    const automation = await store.createAutomation({
      id: 'aut_test',
      userId: user.id,
      projectId,
      name: '每日站会纪要',
      enabled: true,
      trigger: { kind: 'schedule', cron: '0 9 * * *', timezone: TZ },
      actionPrompt: '汇总昨天的项目进展，输出一份站会纪要',
    })

    const enqueued: string[] = []
    const scheduler = new AutomationScheduler({ store, config, enqueue: (taskId) => enqueued.push(taskId) })

    // Not due yet: nothing happens.
    await store.setAutomationNextRun(automation.id, '2026-03-02T01:00:00.000Z')
    expect(await scheduler.tick(new Date('2026-03-02T00:00:00Z'))).toBe(0)

    // Due: one task is created, schedule advances to the next day.
    const created = await scheduler.tick(new Date('2026-03-02T01:00:30Z'))
    expect(created).toBe(1)
    const tasks = await store.listTasks(user.id)
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.prompt).toContain('站会纪要')
    expect(enqueued).toEqual([tasks[0]!.id])

    const advanced = await store.getAutomation(automation.id)
    expect(advanced?.lastRunAt).toBeTruthy()
    expect(new Date(advanced!.nextRunAt!).toISOString()).toBe('2026-03-03T01:00:00.000Z')

    // Second tick at the same instant is a no-op (no double firing).
    expect(await scheduler.tick(new Date('2026-03-02T01:00:40Z'))).toBe(0)
  })
})
