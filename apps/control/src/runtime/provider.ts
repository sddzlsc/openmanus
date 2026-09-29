import type { ContainerInstance, Project, RuntimeEvent, Task } from '@wiwana/protocol'

export interface StartTaskInput {
  task: Task
  project: Project
  capabilityPacks: string[]
  limits: { maxSteps: number; maxTokens: number }
}

export interface RuntimeHandle {
  readonly containerId: string | null
  readonly sessionId: string
  readonly previewPort: number | null
  /** Long-lived project runtime (cloud computer): never disposed after a task. */
  readonly persistent?: boolean
  send(text: string): Promise<void>
  cancel(): Promise<void>
  onEvent(listener: (event: RuntimeEvent) => void): () => void
  dispose(): Promise<void>
}

export interface RuntimeProvider {
  readonly kind: 'mock' | 'docker'
  startTask(input: StartTaskInput): Promise<RuntimeHandle>
  /** Cloud computer: start (or reuse) the project's always-on runtime. */
  ensureProjectRuntime?(project: Project): Promise<ContainerInstance>
  stopProjectRuntime?(projectId: string): Promise<void>
  /** Keep-alive bookkeeping; called on an interval by the control plane. */
  reapIdle?(): Promise<void>
  dispose(): Promise<void>
}

export function capabilityPacksForTask(taskType: Task['type'], prompt: string): string[] {
  const packs = new Set<string>(['core'])
  const text = prompt.toLowerCase()

  switch (taskType) {
    case 'office':
      packs.add('office')
      if (/表|excel|数据|分析|chart|spreadsheet/.test(text)) packs.add('data')
      if (/ppt|幻灯片|演示|slide|deck/.test(text)) packs.add('office')
      break
    case 'data':
      packs.add('data')
      packs.add('office')
      break
    case 'web':
      packs.add('web')
      break
    case 'fullstack':
      packs.add('fullstack')
      packs.add('web')
      packs.add('data')
      packs.add('office')
      break
    case 'media':
      packs.add('media')
      break
    case 'research':
      packs.add('research')
      packs.add('office')
      break
    case 'automation':
      packs.add('automation')
      break
  }

  if (/图片|配图|海报|图像|image|logo/.test(text)) packs.add('media')
  if (/视频|video/.test(text)) packs.add('media')
  if (/音乐|歌曲|music|bgm/.test(text)) packs.add('media')
  return [...packs]
}
