import path from 'node:path'

export interface RuntimeAgentConfig {
  port: number
  host: string
  token: string
  workspace: string
  previewPort: number
  /** Port the generated project's own backend listens on inside the sandbox. */
  projectApiPort: number
  capabilitiesRoot: string
  dsh: {
    enabled: boolean
    binary: string
    profile: string
    endpoint: string
    port: number
    home: string
    workspace: string
    timeoutMs: number
  }
  task: {
    taskId: string
    type: string
    capabilityPacks: string[]
    maxSteps: number
    maxTokens: number
  }
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeAgentConfig {
  const workspace = env.WIWANA_WORKSPACE ?? '/workspace'
  return {
    port: Number(env.WIWANA_RUNTIME_PORT ?? 8790),
    host: env.WIWANA_RUNTIME_HOST ?? '0.0.0.0',
    token: env.WIWANA_RUNTIME_TOKEN ?? 'dev-runtime-token',
    workspace,
    previewPort: Number(env.WIWANA_PREVIEW_PORT ?? 5173),
    projectApiPort: Number(env.PROJECT_API_PORT ?? 8788),
    capabilitiesRoot: env.WIWANA_CAPABILITIES_ROOT ?? path.resolve('/opt/wiwana/capabilities'),
    dsh: {
      enabled: env.DSH_ENABLED !== 'false',
      binary: env.DSH_BINARY ?? 'dsh',
      profile: env.DSH_PROFILE ?? 'wiwana-task',
      endpoint: `http://127.0.0.1:${env.DSH_PORT ?? 3080}`,
      port: Number(env.DSH_PORT ?? 3080),
      home: env.DSH_HOME ?? path.join(env.HOME ?? '/home/agent', '.dsh'),
      workspace,
      timeoutMs: Number(env.DSH_TASK_TIMEOUT_MS ?? 20 * 60 * 1000),
    },
    task: {
      taskId: env.WIWANA_TASK_ID ?? 'local-task',
      type: env.WIWANA_TASK_TYPE ?? 'office',
      capabilityPacks: (env.WIWANA_CAPABILITY_PACKS ?? 'core,office').split(',').map((s) => s.trim()).filter(Boolean),
      maxSteps: Number(env.WIWANA_MAX_STEPS ?? 40),
      maxTokens: Number(env.WIWANA_MAX_TOKENS ?? 200_000),
    },
  }
}
