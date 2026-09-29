import type {
  Artifact,
  Automation,
  Connector,
  ContainerInstance,
  Notification,
  Project,
  Task,
  TaskEvent,
  UsageRecord,
  User,
} from '@wiwana/protocol'

export interface UsageDelta {
  tokens?: number
  images?: number
  videos?: number
  containerMinutes?: number
  tasks?: number
}

export interface UserQuotaOverride {
  dailyTokens?: number
  dailyImages?: number
  dailyVideos?: number
  maxRunningTasks?: number
}

export interface Store {
  // users
  createUser(input: { phone?: string | null; wechatOpenId?: string | null; displayName?: string }): Promise<User>
  getUser(id: string): Promise<User | null>
  getUserByPhone(phone: string): Promise<User | null>
  getUserByWechat(openId: string): Promise<User | null>
  listUsers(): Promise<User[]>
  setUserRole(userId: string, role: User['role']): Promise<void>
  setUserQuota(userId: string, quota: UserQuotaOverride | null): Promise<void>
  getUserQuota(userId: string): Promise<UserQuotaOverride | null>

  // projects
  createProject(input: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project>
  getProject(id: string): Promise<Project | null>
  listProjects(userId: string): Promise<Project[]>
  deleteProject(id: string): Promise<void>
  touchProject(id: string, patch?: Partial<Pick<Project, 'previewDomain' | 'name' | 'environment'>>): Promise<Project | null>

  // tasks
  createTask(input: Omit<Task, 'createdAt' | 'updatedAt'>): Promise<Task>
  getTask(id: string): Promise<Task | null>
  listTasks(userId: string, limit?: number): Promise<Task[]>
  listTasksByStatus(status: Task['status']): Promise<Task[]>
  updateTask(id: string, patch: Partial<Task>): Promise<Task | null>

  // messages
  addMessage(input: { id: string; taskId: string; role: 'user' | 'agent' | 'system'; text: string }): Promise<void>
  listMessages(taskId: string): Promise<Array<{ id: string; taskId: string; role: string; text: string; createdAt: string }>>

  // task events (durable log driving SSE)
  appendTaskEvent(taskId: string, event: TaskEvent): Promise<TaskEvent>
  listTaskEvents(taskId: string, fromSeq?: number): Promise<TaskEvent[]>

  // artifacts
  createArtifact(input: Omit<Artifact, 'createdAt'>): Promise<Artifact>
  getArtifact(id: string): Promise<Artifact | null>
  getArtifactByShareSlug(slug: string): Promise<Artifact | null>
  listArtifacts(filter: { userId?: string; projectId?: string; taskId?: string }): Promise<Artifact[]>
  updateArtifact(id: string, patch: Partial<Artifact>): Promise<Artifact | null>

  // containers
  upsertContainer(input: ContainerInstance): Promise<ContainerInstance>
  getContainer(id: string): Promise<ContainerInstance | null>
  listContainers(): Promise<ContainerInstance[]>
  findRunningContainerForProject(projectId: string): Promise<ContainerInstance | null>

  // usage
  getUsage(userId: string, day?: string): Promise<UsageRecord>
  addUsage(userId: string, day: string, delta: UsageDelta): Promise<UsageRecord>

  // notifications
  addNotification(input: Omit<Notification, 'createdAt' | 'readAt'>): Promise<Notification>
  listNotifications(userId: string, limit?: number): Promise<Notification[]>
  markNotificationRead(id: string, userId: string): Promise<void>

  // automations + connectors (M5 surface; stored now, executed later)
  createAutomation(input: Omit<Automation, 'createdAt' | 'lastRunAt' | 'nextRunAt'>): Promise<Automation>
  listAutomations(userId: string): Promise<Automation[]>
  getAutomation(id: string): Promise<Automation | null>
  setAutomationEnabled(id: string, userId: string, enabled: boolean): Promise<Automation | null>
  setAutomationNextRun(id: string, nextRunAt: string | null): Promise<void>
  deleteAutomation(id: string, userId: string): Promise<boolean>
  /** Enabled schedule automations whose next run is at or before `now`. */
  listDueAutomations(now: Date): Promise<Automation[]>
  updateAutomationRun(id: string, lastRunAt: string, nextRunAt: string | null): Promise<void>
  listConnectors(userId: string): Promise<Connector[]>
  upsertConnector(input: Omit<Connector, 'createdAt'>): Promise<Connector>

  // one-time passwords for phone login (short-lived)
  putOtp(phone: string, code: string, expiresAt: number): Promise<void>
  takeOtp(phone: string): Promise<{ code: string; expiresAt: number } | null>

  close(): Promise<void>
}

export function emptyUsage(userId: string, day: string): UsageRecord {
  return { userId, day, tokens: 0, images: 0, videos: 0, containerMinutes: 0, tasks: 0 }
}
