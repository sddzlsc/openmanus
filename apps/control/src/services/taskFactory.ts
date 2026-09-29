import type { Project, Task, TaskType } from '@wiwana/protocol'
import { newId } from '../lib/ids.js'
import type { Store } from '../store/types.js'
import type { AppConfig } from '../config.js'

export interface CreateTaskInput {
  userId: string
  type: TaskType
  prompt: string
  title?: string
  projectId?: string | null
  /** Where the task came from, surfaced in the notification body. */
  origin?: 'web' | 'automation' | 'api'
}

export interface CreateTaskDeps {
  store: Store
  config: AppConfig
  enqueue: (taskId: string) => void
}

/**
 * The single task-creation path shared by the HTTP API, the automation
 * scheduler and the connector webhook. Keeping it in one place is what makes
 * "create a task" behave identically however it was triggered.
 */
export async function createTaskForUser(
  deps: CreateTaskDeps,
  input: CreateTaskInput,
): Promise<{ task: Task; project: Project }> {
  let project = input.projectId ? await deps.store.getProject(input.projectId) : null
  if (input.projectId && (!project || project.userId !== input.userId)) {
    throw new Error('项目不存在')
  }
  if (!project) {
    const projectId = newId('prj')
    project = await deps.store.createProject({
      id: projectId,
      userId: input.userId,
      name: input.title?.slice(0, 40) ?? input.prompt.replace(/\s+/g, ' ').slice(0, 40),
      workspaceKey: `ws_${projectId}`,
      environment: 'task-sandbox',
      previewDomain: `s-${projectId}.${deps.config.previewDomain}`,
    })
  }

  const prompt = input.prompt.trim()
  const task = await deps.store.createTask({
    id: newId('task'),
    userId: input.userId,
    projectId: project.id,
    type: input.type,
    title: input.title ?? (prompt.length > 24 ? `${prompt.slice(0, 24)}…` : prompt),
    prompt,
    status: 'queued',
    progress: 0,
    sessionId: null,
    containerId: null,
    error: null,
    resultSummary: null,
    startedAt: null,
    finishedAt: null,
  })
  await deps.store.addMessage({ id: newId('msg'), taskId: task.id, role: 'user', text: prompt })
  await deps.store.addNotification({
    id: newId('ntf'),
    userId: input.userId,
    taskId: task.id,
    level: 'info',
    title: input.origin === 'automation' ? `自动化已触发：${task.title}` : '任务已创建',
    body:
      input.origin === 'automation'
        ? '这是自动化任务，完成后会在这里通知你。'
        : '已进入执行队列，可离开页面，完成后会通知你。',
  })
  await deps.store.touchProject(project.id)
  deps.enqueue(task.id)
  return { task, project }
}
