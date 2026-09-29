import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import Docker from 'dockerode'
import type { RuntimeEvent } from '@wiwana/protocol'
import { RuntimeAgentClient } from './agentClient.js'
import type { RuntimeHandle, RuntimeProvider, StartTaskInput } from './provider.js'

export interface DockerProviderOptions {
  image: string
  workspaceRoot: string
  cpus: number
  memoryMb: number
  agentPort: number
  previewPort: number
  network: string
  previewDomain: string
  /**
   * How the control plane reaches the runtime agent inside the sandbox:
   *  - `host-port`: the sandbox publishes 127.0.0.1:<random> and the control
   *    plane runs on the same host (local `pnpm dev:control`).
   *  - `container-dns`: both containers share a user-defined network and the
   *    control plane dials the container name (control plane itself in Docker,
   *    and the production compose layout).
   */
  connectMode?: 'host-port' | 'container-dns'
  /**
   * Environment variables copied from the control plane into the sandbox when
   * set. Only model/provider credentials belong here — never product secrets.
   */
  envPassthrough?: string[]
}

/**
 * One container per task (v1 default environment). The container runs the
 * sandbox image: dsh + capability packs + the runtime agent. The control plane
 * talks only to the runtime agent over an ephemeral host port bound to
 * 127.0.0.1, so the dsh API itself is never exposed.
 */
export class DockerRuntimeProvider implements RuntimeProvider {
  readonly kind = 'docker' as const
  private docker: Docker

  constructor(private readonly options: DockerProviderOptions) {
    this.docker = new Docker()
  }

  async startTask(input: StartTaskInput): Promise<RuntimeHandle> {
    const workspace = path.join(this.options.workspaceRoot, input.project.workspaceKey)
    await mkdir(workspace, { recursive: true })
    const token = `rt_${input.task.id}_${Math.random().toString(36).slice(2, 10)}`

    const labels: Record<string, string> = {
      'wiwana.role': 'sandbox',
      'wiwana.task': input.task.id,
      'wiwana.project': input.project.id,
      'traefik.enable': 'true',
      [`traefik.http.routers.${input.project.id}.rule`]: `Host(\`s-${input.project.id}.${this.options.previewDomain}\`)`,
      [`traefik.http.routers.${input.project.id}.entrypoints`]: 'websecure',
      [`traefik.http.services.${input.project.id}.loadbalancer.server.port`]: String(this.options.previewPort),
    }

    const container = await this.docker.createContainer({
      Image: this.options.image,
      name: containerName(input.task.id),
      Labels: labels,
      Env: [
        `WIWANA_RUNTIME_TOKEN=${token}`,
        `WIWANA_TASK_ID=${input.task.id}`,
        `WIWANA_TASK_TYPE=${input.task.type}`,
        `WIWANA_CAPABILITY_PACKS=${input.capabilityPacks.join(',')}`,
        `WIWANA_MAX_STEPS=${input.limits.maxSteps}`,
        `WIWANA_MAX_TOKENS=${input.limits.maxTokens}`,
        `DSH_HOME=/home/agent/.dsh`,
        ...this.passthroughEnv(),
      ],
      WorkingDir: '/workspace',
      ExposedPorts: {
        [`${this.options.agentPort}/tcp`]: {},
        [`${this.options.previewPort}/tcp`]: {},
      },
      HostConfig: {
        Binds: [`${workspace}:/workspace`],
        Memory: this.options.memoryMb * 1024 * 1024,
        NanoCpus: Math.round(this.options.cpus * 1e9),
        PidsLimit: 512,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges'],
        NetworkMode: await this.resolveNetwork(),
        PortBindings: {
          [`${this.options.agentPort}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: '' }],
          [`${this.options.previewPort}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: '' }],
        },
      },
    })

    await container.start()
    const inspect = await container.inspect()
    const agentBinding = inspect.NetworkSettings.Ports[`${this.options.agentPort}/tcp`]?.[0]
    const previewBinding = inspect.NetworkSettings.Ports[`${this.options.previewPort}/tcp`]?.[0]
    if (!agentBinding?.HostPort) {
      await container.remove({ force: true }).catch(() => {})
      throw new Error('sandbox container did not publish the runtime agent port')
    }

    const endpoint =
      (this.options.connectMode ?? 'host-port') === 'container-dns'
        ? `http://${containerName(input.task.id)}:${this.options.agentPort}`
        : `http://127.0.0.1:${agentBinding.HostPort}`
    const client = new RuntimeAgentClient(endpoint, token)
    await waitForHealth(client, 60_000)
    const session = await client.startSession({
      taskId: input.task.id,
      type: input.task.type,
      prompt: input.task.prompt,
      capabilityPacks: input.capabilityPacks,
      limits: input.limits,
    })

    return new DockerRuntimeHandle({
      container,
      client,
      sessionId: session.sessionId,
      previewPort: previewBinding?.HostPort ? Number(previewBinding.HostPort) : null,
    })
  }

  async dispose() {}

  private passthroughEnv(): string[] {
    const names = this.options.envPassthrough ?? []
    return names.flatMap((name) => {
      const value = process.env[name]
      return value ? [`${name}=${value}`] : []
    })
  }

  /**
   * The named sandbox network is created by `deploy/compose/docker-compose.yml`
   * (or by the operator). Local runs without it fall back to the default bridge
   * so a missing network never blocks task execution outright.
   */
  private async resolveNetwork(): Promise<string> {
    try {
      await this.docker.getNetwork(this.options.network).inspect()
      return this.options.network
    } catch {
      return 'bridge'
    }
  }
}

class DockerRuntimeHandle implements RuntimeHandle {
  readonly containerId: string
  readonly sessionId: string
  readonly previewPort: number | null
  private listeners = new Set<(event: RuntimeEvent) => void>()
  private abort = new AbortController()
  private disposed = false

  constructor(
    private readonly input: {
      container: Docker.Container
      client: RuntimeAgentClient
      sessionId: string
      previewPort: number | null
    },
  ) {
    this.containerId = input.container.id
    this.sessionId = input.sessionId
    this.previewPort = input.previewPort
    void this.pump()
  }

  onEvent(listener: (event: RuntimeEvent) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async send(text: string) {
    await this.input.client.sendMessage(this.sessionId, text)
  }

  async cancel() {
    await this.input.client.cancel(this.sessionId).catch(() => {})
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    this.abort.abort()
    this.listeners.clear()
    await this.input.container.stop({ t: 5 }).catch(() => {})
    await this.input.container.remove({ force: true }).catch(() => {})
  }

  private async pump() {
    while (!this.disposed) {
      try {
        await this.input.client.subscribe(this.sessionId, (event) => {
          for (const listener of this.listeners) listener(event)
        }, this.abort.signal)
        return
      } catch (error) {
        if (this.disposed) return
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
  }
}

async function waitForHealth(client: RuntimeAgentClient, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const health = await client.health()
      if (health.ok) return
    } catch {
      // container still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('sandbox runtime agent did not become healthy in time')
}

/** Sandbox container name; also the DNS name used in `container-dns` mode. */
function containerName(taskId: string): string {
  return `wiwana-task-${taskId}`
}
