import type {
  Automation,
  Artifact,
  Notification,
  Project,
  Task,
  TaskEvent,
  TaskTemplate,
  UsageSnapshot,
  User,
} from '@wiwana/protocol'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Only declare a JSON content-type when a body is actually sent: with an empty
  // body the server rejects the request before running the handler.
  const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) }
  if (init?.body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers,
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    const error = new Error(
      response.status === 401
        ? '请先登录再执行任务（开发环境验证码 000000）'
        : (body?.error?.message ?? `请求失败（${response.status}）`),
    )
    error.name = response.status === 401 ? 'UnauthorizedError' : 'ApiError'
    throw error
  }
  return (await response.json()) as T
}

/**
 * Client-side failures never reach the control plane on their own, so they are
 * reported explicitly and show up in `docker logs wiwana-control`.
 */
export function reportClientError(error: unknown, where: string, detail?: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message,
      where,
      url: typeof window === 'undefined' ? undefined : window.location.href,
      detail,
    }),
  }).catch(() => {})
}

export const api = {
  me: () => request<{ user: User }>('/api/me'),
  templates: () => request<{ templates: TaskTemplate[] }>('/api/templates'),
  usage: () => request<{ usage: UsageSnapshot }>('/api/usage'),
  tasks: () => request<{ tasks: Task[] }>('/api/tasks'),
  task: (id: string) => request<{ task: Task; project: Project; artifacts: Artifact[] }>(`/api/tasks/${id}`),
  createTask: (payload: { type: string; prompt: string; title?: string; projectId?: string }) =>
    request<{ task: Task; project: Project }>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  sendMessage: (id: string, text: string) =>
    request<{ ok: boolean }>(`/api/tasks/${id}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  cancelTask: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  rescanTask: (id: string) => request<{ added: Artifact[]; scanned: number }>(`/api/tasks/${id}/rescan`, { method: 'POST' }),
  exportTaskUrl: (id: string) => `/api/tasks/${id}/export`,
  exportProjectUrl: (id: string) => `/api/projects/${id}/export`,
  exportDocxUrl: (id: string) => `/api/artifacts/${id}/export.docx`,
  automations: () => request<{ automations: Automation[] }>('/api/automations'),
  createAutomation: (payload: {
    projectId: string
    name: string
    actionPrompt: string
    trigger: { kind: 'schedule'; cron: string; timezone: string } | { kind: 'connector-event'; provider: string; event: string }
  }) => request<{ automation: Automation; note: string }>('/api/automations', { method: 'POST', body: JSON.stringify(payload) }),
  setAutomationEnabled: (id: string, enabled: boolean) =>
    request<{ automation: Automation }>(`/api/automations/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  deleteAutomation: (id: string) => request<{ ok: boolean }>(`/api/automations/${id}`, { method: 'DELETE' }),
  runAutomationNow: (id: string) => request<{ ok: boolean }>(`/api/automations/${id}/run-now`, { method: 'POST' }),
  artifacts: () => request<{ artifacts: Artifact[] }>('/api/artifacts'),
  artifact: (id: string) => request<{ artifact: Artifact }>(`/api/artifacts/${id}`),
  projects: () => request<{ projects: Project[] }>('/api/projects'),
  shareArtifact: (id: string, enabled: boolean) =>
    request<{ artifact: Artifact; shareUrl: string | null }>(`/api/artifacts/${id}/share`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  notifications: () => request<{ notifications: Notification[] }>('/api/notifications'),
  requestCode: (phone: string) =>
    request<{ ok: boolean; devCode?: string }>('/api/auth/phone/request-code', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  verifyCode: (phone: string, code: string) =>
    request<{ user: User }>('/api/auth/phone/verify', {
      method: 'POST',
      body: JSON.stringify({ phone, code }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
}

/** Subscribe to a task event stream with automatic reconnect + replay. */
export function subscribeTask(taskId: string, onEvent: (event: TaskEvent) => void): () => void {
  let source: EventSource | null = null
  let closed = false
  let lastSeq = 0

  const connect = () => {
    if (closed) return
    source = new EventSource(`/api/tasks/${taskId}/stream?from=${lastSeq}`)
    const handle = (raw: MessageEvent<string>) => {
      // Frames can arrive malformed (proxy noise, truncated reconnects); a bad
      // frame must not break the stream for the rest of the task.
      try {
        const event = JSON.parse(raw.data) as TaskEvent
        if (typeof event?.seq !== 'number') return
        lastSeq = Math.max(lastSeq, event.seq)
        onEvent(event)
      } catch {
        // ignore
      }
    }
    for (const name of ['status', 'thought', 'tool', 'message', 'artifact', 'terminal', 'screenshot', 'usage', 'error', 'done']) {
      source.addEventListener(name, handle as EventListener)
    }
    source.onerror = () => {
      source?.close()
      if (!closed) setTimeout(connect, 1500)
    }
  }

  connect()
  return () => {
    closed = true
    source?.close()
  }
}
