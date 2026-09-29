import type { RuntimeEvent, RuntimeHealth, RuntimeSessionHandle } from '@wiwana/protocol'

/**
 * Client for the runtime agent that runs inside every sandbox container.
 * The agent owns the dsh process; the control plane never talks to dsh directly.
 */
export class RuntimeAgentClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }
  }

  async health(): Promise<RuntimeHealth> {
    const response = await fetch(`${this.baseUrl}/healthz`, { headers: this.headers() })
    if (!response.ok) throw new Error(`runtime agent health failed: ${response.status}`)
    return (await response.json()) as RuntimeHealth
  }

  async startSession(input: {
    taskId: string
    type: string
    prompt: string
    capabilityPacks: string[]
    limits: { maxSteps: number; maxTokens: number }
  }): Promise<RuntimeSessionHandle & { previewPort: number | null }> {
    const response = await fetch(`${this.baseUrl}/v1/sessions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    })
    if (!response.ok) throw new Error(`runtime agent start failed: ${response.status} ${await response.text()}`)
    return (await response.json()) as RuntimeSessionHandle & { previewPort: number | null }
  }

  async sendMessage(sessionId: string, text: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ text }),
    })
    if (!response.ok) throw new Error(`runtime agent send failed: ${response.status}`)
  }

  async cancel(sessionId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/cancel`, {
      method: 'POST',
      headers: this.headers(),
    })
    if (!response.ok && response.status !== 404) throw new Error(`runtime agent cancel failed: ${response.status}`)
  }

  async subscribe(sessionId: string, onEvent: (event: RuntimeEvent) => void, signal: AbortSignal): Promise<void> {
    const response = await fetch(`${this.baseUrl}/v1/sessions/${sessionId}/events`, {
      headers: { accept: 'text/event-stream', authorization: `Bearer ${this.token}` },
      signal,
    })
    if (!response.ok || !response.body) throw new Error(`runtime agent subscribe failed: ${response.status}`)

    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
        const data = frame
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) onEvent(JSON.parse(data) as RuntimeEvent)
      }
    }
  }
}
