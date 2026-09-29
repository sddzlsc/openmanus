import { describe, expect, it } from 'vitest'
import { PostgresStore } from '../src/store/postgres.js'
import { newId } from '../src/lib/ids.js'

/**
 * PostgreSQL round-trip test. Runs only when DATABASE_URL is set (CI or a local
 * `docker run postgres`) and the schema from `deploy/sql/001_init.sql` exists:
 *
 *   DATABASE_URL=postgres://wiwana:wiwana-dev-password@127.0.0.1:5432/wiwana pnpm --filter @wiwana/control test
 */
const databaseUrl = process.env.DATABASE_URL

describe.skipIf(!databaseUrl)('postgres store', () => {
  it('round-trips users, projects, tasks, events and artifacts', async () => {
    const store = new PostgresStore(databaseUrl!)
    try {
      const user = await store.createUser({ phone: `199${Date.now().toString().slice(-8)}` })
      expect(user.id).toMatch(/^usr_/)
      expect(await store.getUser(user.id)).toMatchObject({ id: user.id })

      const projectId = newId('prj')
      const project = await store.createProject({
        id: projectId,
        userId: user.id,
        name: 'PG 测试项目',
        workspaceKey: `ws_${projectId}`,
        environment: 'task-sandbox',
        previewDomain: null,
      })
      expect(project.id).toBe(projectId)

      const task = await store.createTask({
        id: newId('task'),
        userId: user.id,
        projectId: project.id,
        type: 'office',
        title: 'PG 测试任务',
        prompt: '写一份周报',
        status: 'queued',
        progress: 0,
        sessionId: null,
        containerId: null,
        error: null,
        resultSummary: null,
        startedAt: null,
        finishedAt: null,
      })
      const stored = await store.appendTaskEvent(task.id, {
        type: 'status',
        seq: 0,
        at: new Date().toISOString(),
        status: 'running',
        progress: 10,
      })
      expect(stored.seq).toBe(1)
      const events = await store.listTaskEvents(task.id)
      expect(events).toHaveLength(1)

      const artifact = await store.createArtifact({
        id: newId('art'),
        taskId: task.id,
        projectId: project.id,
        userId: user.id,
        kind: 'doc',
        name: 'report.md',
        path: 'report.md',
        mime: 'text/markdown',
        sizeBytes: 12,
        previewUrl: null,
        downloadUrl: null,
        shareEnabled: true,
        shareSlug: newId('sh'),
      })
      expect(await store.getArtifactByShareSlug(artifact.shareSlug!)).toMatchObject({ id: artifact.id })

      const usage = await store.addUsage(user.id, '2026-01-01', { tokens: 120, tasks: 1 })
      expect(usage.tokens).toBe(120)
      // The quota path calls getUsage without a day; it must default instead of
      // passing `undefined` (postgres-js rejects undefined parameters).
      expect((await store.getUsage(user.id)).tokens).toBe(0)
      expect((await store.getUsage(user.id, '2026-01-01')).tokens).toBe(120)

      await store.setUserQuota(user.id, { dailyTokens: 1000 })
      expect(await store.getUserQuota(user.id)).toMatchObject({ dailyTokens: 1000 })
    } finally {
      await store.close()
    }
  })
})
