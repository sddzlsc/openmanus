import type {
  Artifact,
  Automation,
  Connector,
  Notification,
  Project,
  Task,
  TaskType,
  UsageSnapshot,
  User,
} from './domain.js'

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

export interface CreateTaskRequest {
  projectId?: string
  type: TaskType
  title?: string
  prompt: string
  /** Attachment ids uploaded through `POST /api/uploads`. */
  attachmentIds?: string[]
}

export interface CreateTaskResponse {
  task: Task
  project: Project
}

export interface ListTasksResponse {
  tasks: Task[]
}

export interface TaskDetailResponse {
  task: Task
  project: Project
  artifacts: Artifact[]
}

export interface SendMessageRequest {
  text: string
  attachmentIds?: string[]
}

export interface CreateProjectRequest {
  name: string
  environment?: 'task-sandbox' | 'project-workspace'
}

export interface ListProjectsResponse {
  projects: Project[]
}

export interface ListArtifactsResponse {
  artifacts: Artifact[]
}

export interface ShareArtifactRequest {
  enabled: boolean
}

export interface ShareArtifactResponse {
  artifact: Artifact
  shareUrl: string | null
}

export interface UsageResponse {
  usage: UsageSnapshot
}

export interface NotificationsResponse {
  notifications: Notification[]
}

export interface AutomationsResponse {
  automations: Automation[]
}

export interface ConnectorsResponse {
  connectors: Connector[]
}

export interface LoginPhoneRequest {
  phone: string
}

export interface LoginPhoneVerifyRequest {
  phone: string
  code: string
}

export interface LoginResponse {
  user: User
  token: string
}

export interface MeResponse {
  user: User
}

export interface AdminOverviewResponse {
  users: number
  tasks: { queued: number; running: number; done: number; failed: number }
  containers: { running: number; idle: number; sleeping: number }
}

export interface UploadResponse {
  attachmentId: string
  name: string
  mime: string
  sizeBytes: number
}

/** Task templates surfaced in the composer. */
export interface TaskTemplate {
  id: string
  type: TaskType
  title: string
  description: string
  examplePrompt: string
}

export interface TemplatesResponse {
  templates: TaskTemplate[]
}
