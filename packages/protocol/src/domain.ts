/** Task kinds the platform can schedule. v1 ships office/data/web/media; M4 adds browser + connectors. */
export type TaskType =
  | 'office' // documents, spreadsheets, slides, pdf
  | 'data' // analysis + charts
  | 'web' // websites / web apps
  | 'media' // image / video / music generation
  | 'research' // research + browser automation (M4/M5)
  | 'automation' // scheduled / event-triggered (M5)

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'waiting_user'
  | 'done'
  | 'failed'
  | 'cancelled'

export type ArtifactKind =
  | 'doc'
  | 'sheet'
  | 'slides'
  | 'pdf'
  | 'image'
  | 'video'
  | 'audio'
  | 'website'
  | 'code'
  | 'chart'
  | 'dataset'
  | 'file'

export type ContainerState =
  | 'creating'
  | 'ready'
  | 'busy'
  | 'idle'
  | 'sleeping'
  | 'error'
  | 'destroyed'

export type ExecutionEnvironment =
  | 'task-sandbox' // ephemeral, one per task (default)
  | 'project-workspace' // persistent per project, sleep/wake
  | 'cloud-computer' // always-on (M5)

export interface User {
  id: string
  phone: string | null
  wechatOpenId: string | null
  displayName: string
  role: 'user' | 'admin'
  status: 'active' | 'disabled'
  createdAt: string
}

export interface Project {
  id: string
  userId: string
  name: string
  /** Workspace volume key; resolved by the sandbox provider. */
  workspaceKey: string
  environment: ExecutionEnvironment
  previewDomain: string | null
  createdAt: string
  updatedAt: string
}

export interface Task {
  id: string
  userId: string
  projectId: string
  type: TaskType
  title: string
  prompt: string
  status: TaskStatus
  progress: number
  /** Runtime session id (opaque; owned by dsh inside the sandbox). */
  sessionId: string | null
  containerId: string | null
  error: string | null
  resultSummary: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface Message {
  id: string
  taskId: string
  role: 'user' | 'agent' | 'system'
  text: string
  createdAt: string
}

export interface Artifact {
  id: string
  taskId: string | null
  projectId: string
  userId: string
  kind: ArtifactKind
  name: string
  /** Path relative to the workspace root inside the sandbox. */
  path: string
  mime: string
  sizeBytes: number
  previewUrl: string | null
  downloadUrl: string | null
  shareEnabled: boolean
  shareSlug: string | null
  createdAt: string
}

export interface ContainerInstance {
  id: string
  projectId: string
  taskId: string | null
  provider: 'mock' | 'docker'
  externalId: string
  state: ContainerState
  endpoint: string | null
  /** Bearer token for the runtime agent; persisted so long-lived runtimes survive a control-plane restart. */
  runtimeToken: string | null
  previewPort: number | null
  startedAt: string
  lastActivityAt: string
  stoppedAt: string | null
}

export interface UsageRecord {
  userId: string
  day: string // YYYY-MM-DD
  tokens: number
  images: number
  videos: number
  containerMinutes: number
  tasks: number
}

export interface Notification {
  id: string
  userId: string
  taskId: string | null
  level: 'info' | 'success' | 'warning' | 'error'
  title: string
  body: string
  readAt: string | null
  createdAt: string
}

export interface Automation {
  id: string
  userId: string
  projectId: string
  name: string
  enabled: boolean
  trigger: AutomationTrigger
  actionPrompt: string
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
}

export type AutomationTrigger =
  | { kind: 'schedule'; cron: string; timezone: string }
  | { kind: 'connector-event'; provider: string; event: string }

export interface Connector {
  id: string
  userId: string
  provider: string
  status: 'connected' | 'expired' | 'revoked'
  /** Reference into the credential store, never a raw secret. */
  credentialRef: string
  createdAt: string
}

export interface UsageSnapshot {
  day: string
  tokens: { used: number; limit: number }
  images: { used: number; limit: number }
  videos: { used: number; limit: number }
  tasks: { used: number }
  runningTasks: { used: number; limit: number }
}
