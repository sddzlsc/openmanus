import path from 'node:path'

export interface QuotaLimits {
  dailyTokens: number
  dailyImages: number
  dailyVideos: number
  maxRunningTasks: number
}

export interface AppConfig {
  port: number
  host: string
  store: 'memory' | 'postgres'
  databaseUrl: string | null
  jwtSecret: string
  sandboxProvider: 'mock' | 'docker'
  workspaceRoot: string
  appDomain: string
  apiDomain: string
  previewDomain: string
  quotas: QuotaLimits
  /** Simulated task duration for the mock runtime (ms). */
  mockTaskDurationMs: number
  sandbox: {
    image: string
    cpus: number
    memoryMb: number
    agentPort: number
    previewPort: number
    idleSleepMs: number
  }
  devAllowFixedOtp: boolean
  /**
   * `local` (default) runs the platform as a single-user, login-free instance —
   * the shape most people want when self-hosting. `phone` enables the SMS/OTP
   * account system for multi-user deployments.
   */
  authMode: 'local' | 'phone'
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: num(env.PORT, 8787),
    host: env.HOST ?? '127.0.0.1',
    store: env.STORE === 'postgres' ? 'postgres' : 'memory',
    databaseUrl: env.DATABASE_URL ?? null,
    jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-me',
    sandboxProvider: env.SANDBOX_PROVIDER === 'docker' ? 'docker' : 'mock',
    workspaceRoot: path.resolve(env.WORKSPACE_ROOT ?? './data/workspaces'),
    appDomain: env.APP_DOMAIN ?? 'app.wiwana.local',
    apiDomain: env.API_DOMAIN ?? 'api.wiwana.local',
    previewDomain: env.PREVIEW_DOMAIN ?? 'wiwana.local',
    quotas: {
      dailyTokens: num(env.QUOTA_DAILY_TOKENS, 200_000),
      dailyImages: num(env.QUOTA_DAILY_IMAGES, 20),
      dailyVideos: num(env.QUOTA_DAILY_VIDEOS, 3),
      maxRunningTasks: num(env.QUOTA_MAX_RUNNING_TASKS, 1),
    },
    mockTaskDurationMs: num(env.MOCK_TASK_DURATION_MS, 6000),
    sandbox: {
      image: env.SANDBOX_IMAGE ?? 'wiwana/sandbox:0.1.0',
      cpus: num(env.SANDBOX_CPUS, 2),
      memoryMb: num(env.SANDBOX_MEMORY_MB, 4096),
      agentPort: num(env.SANDBOX_AGENT_PORT, 8790),
      previewPort: num(env.SANDBOX_PREVIEW_PORT, 5173),
      idleSleepMs: num(env.SANDBOX_IDLE_SLEEP_MS, 15 * 60 * 1000),
    },
    devAllowFixedOtp: env.DEV_FIXED_OTP !== 'false',
    authMode: env.AUTH_MODE === 'phone' ? 'phone' : 'local',
  }
}
