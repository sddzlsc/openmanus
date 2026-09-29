#!/usr/bin/env node
/**
 * End-to-end smoke test: boots the control plane with the mock sandbox
 * provider, then walks the real product flow through HTTP:
 *   phone login -> create task -> wait for completion -> read artifacts ->
 *   replay the SSE timeline -> check usage.
 *
 * Usage: pnpm --filter @wiwana/control build && node scripts/smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(import.meta.dirname, '..')
const port = Number(process.env.SMOKE_PORT ?? 8898)
const base = `http://127.0.0.1:${port}`

const workdir = await mkdtemp(path.join(tmpdir(), 'wiwana-smoke-'))
const child = spawn(process.execPath, [path.join(root, 'apps/control/dist/main.js')], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    JWT_SECRET: 'smoke-secret',
    WORKSPACE_ROOT: path.join(workdir, 'workspaces'),
    MOCK_TASK_DURATION_MS: '1500',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let logs = ''
child.stdout.on('data', (chunk) => (logs += chunk.toString()))
child.stderr.on('data', (chunk) => (logs += chunk.toString()))

const fail = (message) => {
  console.error(`\n✗ ${message}`)
  console.error(logs.split('\n').slice(-15).join('\n'))
  child.kill('SIGTERM')
  process.exit(1)
}

const waitForHealth = async () => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${base}/healthz`)
      if (response.ok) return
    } catch {
      // still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  fail('control plane did not become healthy')
}

const json = async (path, init = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
  if (!response.ok) fail(`${path} -> ${response.status} ${await response.text()}`)
  return response.json()
}

try {
  await waitForHealth()
  console.log('✓ control plane healthy')

  const code = await json('/api/auth/phone/request-code', {
    method: 'POST',
    body: JSON.stringify({ phone: '13700000002' }),
  })
  const login = await json('/api/auth/phone/verify', {
    method: 'POST',
    body: JSON.stringify({ phone: '13700000002', code: code.devCode ?? '000000' }),
  })
  const cookie = `wiwana_token=${login.token}`
  console.log(`✓ login as ${login.user.displayName}`)

  const created = await json('/api/tasks', {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ type: 'office', prompt: '生成一份季度汇报文档与图表' }),
  })
  console.log(`✓ task created: ${created.task.id}`)

  let detail = null
  for (let attempt = 0; attempt < 40; attempt += 1) {
    detail = await json(`/api/tasks/${created.task.id}`, { headers: { cookie } })
    if (detail.task.status === 'done' || detail.task.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (detail?.task.status !== 'done') fail(`task ended as ${detail?.task.status}: ${detail?.task.error}`)
  console.log(`✓ task finished with ${detail.artifacts.length} artifacts`)

  const stream = await fetch(`${base}/api/tasks/${created.task.id}/stream?once=1`, { headers: { cookie } })
  const timeline = await stream.text()
  const eventCount = (timeline.match(/^event: /gm) ?? []).length
  if (eventCount === 0) fail('timeline replay returned no events')
  console.log(`✓ timeline replay: ${eventCount} events`)

  const artifact = detail.artifacts[0]
  const share = await json(`/api/artifacts/${artifact.id}/share`, {
    method: 'POST',
    headers: { cookie },
    body: JSON.stringify({ enabled: true }),
  })
  const publicView = await fetch(`${base}/s/${share.artifact.shareSlug}`)
  if (!publicView.ok) fail('shared artifact is not publicly reachable')
  console.log(`✓ share link works: ${share.shareUrl}`)

  const usage = await json('/api/usage', { headers: { cookie } })
  console.log(
    `✓ usage: ${usage.usage.tokens.used} tokens, ${usage.usage.tasks.used} task(s), running ${usage.usage.runningTasks.used}`,
  )

  const workspaceRoot = await stat(path.join(workdir, 'workspaces')).catch(() => null)
  if (!workspaceRoot?.isDirectory()) fail('workspace root was not created')
  console.log('✓ workspace root created on disk')

  console.log(`\nSmoke test passed. Workspace: ${workdir}`)
} finally {
  child.kill('SIGTERM')
}
