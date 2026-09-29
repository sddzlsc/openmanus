import { newId, today } from '../lib/ids.js'
import type { UsageDelta, Store, UserQuotaOverride } from './types.js'
import { emptyUsage } from './types.js'
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

export class MemoryStore implements Store {
  private users = new Map<string, User>()
  private quotas = new Map<string, UserQuotaOverride>()
  private projects = new Map<string, Project>()
  private tasks = new Map<string, Task>()
  private messages = new Map<string, Array<{ id: string; taskId: string; role: string; text: string; createdAt: string }>>()
  private events = new Map<string, TaskEvent[]>()
  private artifacts = new Map<string, Artifact>()
  private containers = new Map<string, ContainerInstance>()
  private usage = new Map<string, UsageRecord>()
  private notifications = new Map<string, Notification>()
  private automations = new Map<string, Automation>()
  private connectors = new Map<string, Connector>()
  private otps = new Map<string, { code: string; expiresAt: number }>()

  async createUser(input: { phone?: string | null; wechatOpenId?: string | null; displayName?: string }): Promise<User> {
    const user: User = {
      id: newId('usr'),
      phone: input.phone ?? null,
      wechatOpenId: input.wechatOpenId ?? null,
      displayName: input.displayName ?? (input.phone ? `用户${input.phone.slice(-4)}` : '新用户'),
      role: 'user',
      status: 'active',
      createdAt: new Date().toISOString(),
    }
    this.users.set(user.id, user)
    return user
  }

  async getUser(id: string) {
    return this.users.get(id) ?? null
  }

  async getUserByPhone(phone: string) {
    return [...this.users.values()].find((u) => u.phone === phone) ?? null
  }

  async getUserByWechat(openId: string) {
    return [...this.users.values()].find((u) => u.wechatOpenId === openId) ?? null
  }

  async listUsers() {
    return [...this.users.values()]
  }

  async setUserRole(userId: string, role: User['role']) {
    const user = this.users.get(userId)
    if (user) this.users.set(userId, { ...user, role })
  }

  async setUserQuota(userId: string, quota: UserQuotaOverride | null) {
    if (quota) this.quotas.set(userId, quota)
    else this.quotas.delete(userId)
  }

  async getUserQuota(userId: string) {
    return this.quotas.get(userId) ?? null
  }

  async createProject(input: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> {
    const now = new Date().toISOString()
    const project: Project = { ...input, createdAt: now, updatedAt: now }
    this.projects.set(project.id, project)
    return project
  }

  async getProject(id: string) {
    return this.projects.get(id) ?? null
  }

  async listProjects(userId: string) {
    return [...this.projects.values()]
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async deleteProject(id: string) {
    this.projects.delete(id)
  }

  async touchProject(id: string, patch: Partial<Pick<Project, 'previewDomain' | 'name' | 'environment'>> = {}) {
    const project = this.projects.get(id)
    if (!project) return null
    const next: Project = { ...project, ...patch, updatedAt: new Date().toISOString() }
    this.projects.set(id, next)
    return next
  }

  async createTask(input: Omit<Task, 'createdAt' | 'updatedAt'>): Promise<Task> {
    const now = new Date().toISOString()
    const task: Task = { ...input, createdAt: now, updatedAt: now }
    this.tasks.set(task.id, task)
    return task
  }

  async getTask(id: string) {
    return this.tasks.get(id) ?? null
  }

  async listTasks(userId: string, limit = 50) {
    return [...this.tasks.values()]
      .filter((t) => t.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  async listTasksByStatus(status: Task['status']) {
    return [...this.tasks.values()].filter((t) => t.status === status)
  }

  async updateTask(id: string, patch: Partial<Task>) {
    const task = this.tasks.get(id)
    if (!task) return null
    const next: Task = { ...task, ...patch, updatedAt: new Date().toISOString() }
    this.tasks.set(id, next)
    return next
  }

  async addMessage(input: { id: string; taskId: string; role: 'user' | 'agent' | 'system'; text: string }) {
    const list = this.messages.get(input.taskId) ?? []
    list.push({ ...input, createdAt: new Date().toISOString() })
    this.messages.set(input.taskId, list)
  }

  async listMessages(taskId: string) {
    return this.messages.get(taskId) ?? []
  }

  async appendTaskEvent(taskId: string, event: TaskEvent) {
    const list = this.events.get(taskId) ?? []
    const lastSeq = list.length > 0 ? list[list.length - 1]!.seq : 0
    const next = { ...event, seq: lastSeq + 1 } as TaskEvent
    list.push(next)
    this.events.set(taskId, list)
    return next
  }

  async listTaskEvents(taskId: string, fromSeq = 0) {
    return (this.events.get(taskId) ?? []).filter((e) => e.seq > fromSeq)
  }

  async createArtifact(input: Omit<Artifact, 'createdAt'>): Promise<Artifact> {
    const artifact: Artifact = { ...input, createdAt: new Date().toISOString() }
    this.artifacts.set(artifact.id, artifact)
    return artifact
  }

  async getArtifact(id: string) {
    return this.artifacts.get(id) ?? null
  }

  async getArtifactByShareSlug(slug: string) {
    return [...this.artifacts.values()].find((a) => a.shareSlug === slug) ?? null
  }

  async listArtifacts(filter: { userId?: string; projectId?: string; taskId?: string }) {
    return [...this.artifacts.values()]
      .filter((a) => (filter.userId ? a.userId === filter.userId : true))
      .filter((a) => (filter.projectId ? a.projectId === filter.projectId : true))
      .filter((a) => (filter.taskId ? a.taskId === filter.taskId : true))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async updateArtifact(id: string, patch: Partial<Artifact>) {
    const artifact = this.artifacts.get(id)
    if (!artifact) return null
    const next = { ...artifact, ...patch }
    this.artifacts.set(id, next)
    return next
  }

  async upsertContainer(input: ContainerInstance) {
    this.containers.set(input.id, input)
    return input
  }

  async getContainer(id: string) {
    return this.containers.get(id) ?? null
  }

  async listContainers() {
    return [...this.containers.values()]
  }

  async findRunningContainerForProject(projectId: string) {
    return (
      [...this.containers.values()].find(
        (c) => c.projectId === projectId && c.state !== 'destroyed' && c.state !== 'error',
      ) ?? null
    )
  }

  async getUsage(userId: string, day = today()) {
    return this.usage.get(`${userId}:${day}`) ?? emptyUsage(userId, day)
  }

  async addUsage(userId: string, day: string, delta: UsageDelta) {
    const key = `${userId}:${day}`
    const current = this.usage.get(key) ?? emptyUsage(userId, day)
    const next: UsageRecord = {
      ...current,
      tokens: current.tokens + (delta.tokens ?? 0),
      images: current.images + (delta.images ?? 0),
      videos: current.videos + (delta.videos ?? 0),
      containerMinutes: current.containerMinutes + (delta.containerMinutes ?? 0),
      tasks: current.tasks + (delta.tasks ?? 0),
    }
    this.usage.set(key, next)
    return next
  }

  async addNotification(input: Omit<Notification, 'createdAt' | 'readAt'>) {
    const notification: Notification = { ...input, readAt: null, createdAt: new Date().toISOString() }
    this.notifications.set(notification.id, notification)
    return notification
  }

  async listNotifications(userId: string, limit = 50) {
    return [...this.notifications.values()]
      .filter((n) => n.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  async markNotificationRead(id: string, userId: string) {
    const notification = this.notifications.get(id)
    if (notification && notification.userId === userId) {
      this.notifications.set(id, { ...notification, readAt: new Date().toISOString() })
    }
  }

  async createAutomation(input: Omit<Automation, 'createdAt' | 'lastRunAt' | 'nextRunAt'>) {
    const automation: Automation = { ...input, lastRunAt: null, nextRunAt: null, createdAt: new Date().toISOString() }
    this.automations.set(automation.id, automation)
    return automation
  }

  async listAutomations(userId: string) {
    return [...this.automations.values()].filter((a) => a.userId === userId)
  }

  async setAutomationEnabled(id: string, userId: string, enabled: boolean) {
    const automation = this.automations.get(id)
    if (!automation || automation.userId !== userId) return null
    const next = { ...automation, enabled }
    this.automations.set(id, next)
    return next
  }

  async getAutomation(id: string) {
    return this.automations.get(id) ?? null
  }

  async deleteAutomation(id: string, userId: string) {
    const automation = this.automations.get(id)
    if (!automation || automation.userId !== userId) return false
    return this.automations.delete(id)
  }

  async setAutomationNextRun(id: string, nextRunAt: string | null) {
    const automation = this.automations.get(id)
    if (!automation) return
    this.automations.set(id, { ...automation, nextRunAt })
  }

  async listDueAutomations(now: Date) {
    return [...this.automations.values()].filter(
      (automation) =>
        automation.enabled &&
        automation.trigger.kind === 'schedule' &&
        automation.nextRunAt !== null &&
        new Date(automation.nextRunAt).getTime() <= now.getTime(),
    )
  }

  async updateAutomationRun(id: string, lastRunAt: string, nextRunAt: string | null) {
    const automation = this.automations.get(id)
    if (!automation) return
    this.automations.set(id, { ...automation, lastRunAt, nextRunAt })
  }

  async listConnectors(userId: string) {
    return [...this.connectors.values()].filter((c) => c.userId === userId)
  }

  async upsertConnector(input: Omit<Connector, 'createdAt'>) {
    const connector: Connector = { ...input, createdAt: new Date().toISOString() }
    this.connectors.set(connector.id, connector)
    return connector
  }

  async putOtp(phone: string, code: string, expiresAt: number) {
    this.otps.set(phone, { code, expiresAt })
  }

  async takeOtp(phone: string) {
    const record = this.otps.get(phone)
    if (!record) return null
    this.otps.delete(phone)
    return record
  }

  async close() {
    this.users.clear()
  }
}
