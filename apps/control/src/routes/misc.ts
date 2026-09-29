import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { newId } from '../lib/ids.js'
import { NotFoundError, NotImplementedError } from '../lib/errors.js'
import { requireAdmin, requireAuth, type RouteDeps } from '../routeDeps.js'
import type { TaskTemplate } from '@wiwana/protocol'
import { describeCron, initialNextRun } from '../services/automationScheduler.js'

const uploadSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  dataBase64: z.string().min(1).max(40 * 1024 * 1024),
})

const quotaSchema = z.object({
  dailyTokens: z.number().int().positive().optional(),
  dailyImages: z.number().int().positive().optional(),
  dailyVideos: z.number().int().positive().optional(),
  maxRunningTasks: z.number().int().positive().optional(),
  reset: z.boolean().optional(),
})

const automationSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(120),
  actionPrompt: z.string().min(1).max(8000),
  trigger: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('schedule'), cron: z.string().min(1), timezone: z.string().min(1) }),
    z.object({ kind: z.literal('connector-event'), provider: z.string().min(1), event: z.string().min(1) }),
  ]),
})

const clientErrorSchema = z.object({
  message: z.string().min(1).max(2000),
  where: z.string().max(200).optional(),
  url: z.string().max(500).optional(),
  detail: z.unknown().optional(),
})

export const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'office-report',
    type: 'office',
    title: '生成一份报告',
    description: '调研资料 + 结构化文档 + 图表，产出 Word/PDF/PPT 级交付物',
    examplePrompt: '帮我做一份《2026 年新能源汽车出海趋势》报告，包含市场概况、竞争格局、机会与风险，附一张销量对比图。',
  },
  {
    id: 'office-slides',
    type: 'office',
    title: '做一套演示幻灯片',
    description: '按主题产出 8–12 页演示稿与讲稿要点',
    examplePrompt: '给一家做企业培训的创业公司做一份 10 页融资路演 PPT，包含市场、产品、商业模式、竞争、融资计划。',
  },
  {
    id: 'data-analysis',
    type: 'data',
    title: '数据分析与图表',
    description: '整理数据、计算指标、输出图表与结论',
    examplePrompt: '分析这份月度销售数据（我会在对话里贴出），找出增长最快的品类，画出趋势图并给出三条建议。',
  },
  {
    id: 'web-landing',
    type: 'web',
    title: '搭建一个网站',
    description: '生成可预览、可分享的网页或落地页',
    examplePrompt: '做一个面向宠物医院的预约落地页，包含服务介绍、医生团队、用户评价和预约表单，风格清爽专业。',
  },
  {
    id: 'media-image',
    type: 'media',
    title: '生成图片素材',
    description: '海报、配图、封面、Logo 概念图',
    examplePrompt: '为一家手冲咖啡品牌设计一张新品海报，暖色调，突出「桂花拿铁」四个字。',
  },
  {
    id: 'media-video',
    type: 'media',
    title: '生成短视频',
    description: '30–60 秒产品广告或讲解视频',
    examplePrompt: '生成一条 30 秒的智能音箱产品广告视频，科技感，突出「一句话控制全屋」卖点。',
  },
  {
    id: 'research-brief',
    type: 'research',
    title: '快速调研',
    description: '多来源检索汇总成一份带出处的简报',
    examplePrompt: '调研国内三家人形机器人公司的产品、融资与技术路线，输出对比表和结论。',
  },
]

export async function registerMiscRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  /**
   * Browser-side failures are otherwise invisible to the control plane (the
   * failing request never arrives). The web client posts them here so they show
   * up in the same log stream as the API traffic. Intentionally unauthenticated.
   */
  app.post('/api/client-errors', async (request, reply) => {
    const body = clientErrorSchema.parse(request.body ?? {})
    console.warn(
      `[client-error] where=${body.where ?? '-'} url=${body.url ?? '-'} message=${body.message}` +
        (body.detail === undefined ? '' : ` detail=${JSON.stringify(body.detail).slice(0, 800)}`),
    )
    return reply.code(202).send({ ok: true })
  })

  app.get('/api/templates', async () => ({ templates: TASK_TEMPLATES }))

  app.get('/api/usage', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    return { usage: await deps.quota.snapshot(auth.userId) }
  })

  app.get('/api/notifications', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    return { notifications: await deps.store.listNotifications(auth.userId) }
  })

  app.post('/api/notifications/:id/read', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    await deps.store.markNotificationRead(id, auth.userId)
    return { ok: true }
  })

  app.post('/api/uploads', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const body = uploadSchema.parse(request.body ?? {})
    const id = newId('upl')
    const safeName = body.name.replace(/[^\w.\-\u4e00-\u9fa5]/g, '_').slice(0, 120)
    const dir = path.join(deps.config.workspaceRoot, '_uploads')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${id}-${safeName}`), Buffer.from(body.dataBase64, 'base64'))
    return reply.code(201).send({
      attachmentId: id,
      name: safeName,
      mime: body.mime,
      sizeBytes: Buffer.from(body.dataBase64, 'base64').byteLength,
      uploadedBy: auth.userId,
    })
  })

  app.get('/api/automations', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    return { automations: await deps.store.listAutomations(auth.userId) }
  })

  app.post('/api/automations', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const body = automationSchema.parse(request.body ?? {})
    const project = await deps.store.getProject(body.projectId)
    if (!project || project.userId !== auth.userId) throw new NotFoundError('项目不存在')
    const automation = await deps.store.createAutomation({
      id: newId('aut'),
      userId: auth.userId,
      projectId: body.projectId,
      name: body.name,
      enabled: true,
      trigger: body.trigger,
      actionPrompt: body.actionPrompt,
    })
    const nextRunAt = initialNextRun(automation.trigger)
    await deps.store.setAutomationNextRun(automation.id, nextRunAt)
    if (body.trigger.kind === 'schedule' && nextRunAt === null) {
      return reply.code(400).send({ error: { code: 'invalid_cron', message: 'cron 表达式无法解析' } })
    }
    return reply.code(201).send({
      automation: { ...automation, nextRunAt },
      scheduled: nextRunAt !== null,
      describe: body.trigger.kind === 'schedule' ? describeCron(body.trigger.cron) : '事件触发',
      note:
        nextRunAt !== null
          ? `已排入调度器，下次执行：${nextRunAt}`
          : '事件触发型自动化已保存，等待连接器回调。',
    })
  })

  app.patch('/api/automations/:id', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const body = z.object({ enabled: z.boolean() }).parse(request.body ?? {})
    const automation = await deps.store.getAutomation(id)
    if (!automation || automation.userId !== auth.userId) throw new NotFoundError('自动化不存在')
    const updated = await deps.store.setAutomationEnabled(id, auth.userId, body.enabled)
    if (!updated) throw new NotFoundError('自动化不存在')
    const nextRunAt = body.enabled ? initialNextRun(updated.trigger) : null
    await deps.store.setAutomationNextRun(id, nextRunAt)
    return { automation: { ...updated, nextRunAt } }
  })

  app.delete('/api/automations/:id', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const removed = await deps.store.deleteAutomation(id, auth.userId)
    if (!removed) throw new NotFoundError('自动化不存在')
    return { ok: true }
  })

  /** Trigger now, regardless of the schedule (useful for testing a prompt). */
  app.post('/api/automations/:id/run-now', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const automation = await deps.store.getAutomation(id)
    if (!automation || automation.userId !== auth.userId) throw new NotFoundError('自动化不存在')
    await deps.scheduler.fire({ ...automation, enabled: true })
    return { ok: true }
  })

  app.get('/api/connectors', async (request, reply) => {
    const auth = await requireAuth(deps, request, reply)
    if (!auth) return
    return { connectors: await deps.store.listConnectors(auth.userId) }
  })

  /**
   * Connector webhook: fires every enabled event-triggered automation that
   * matches `provider` + `event`. Callers authenticate with a shared secret
   * (CONNECTOR_WEBHOOK_SECRET) because connectors cannot present a user session.
   */
  app.post('/api/connectors/:provider/callback', async (request, reply) => {
    const provider = (request.params as { provider: string }).provider
    const secret = process.env.CONNECTOR_WEBHOOK_SECRET
    if (!secret) throw new NotImplementedError('未配置 CONNECTOR_WEBHOOK_SECRET，连接器回调暂不可用')
    const provided = (request.headers['x-wiwana-secret'] as string | undefined) ?? ''
    if (provided !== secret) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: '连接器回调签名无效' } })
    }
    const body = z.object({ event: z.string().min(1), payload: z.unknown().optional() }).parse(request.body ?? {})

    const fired: string[] = []
    for (const user of await deps.store.listUsers()) {
      for (const automation of await deps.store.listAutomations(user.id)) {
        if (!automation.enabled) continue
        if (automation.trigger.kind !== 'connector-event') continue
        if (automation.trigger.provider !== provider) continue
        if (automation.trigger.event !== body.event) continue
        const context =
          body.payload === undefined ? '' : `\n\n事件内容：\n${JSON.stringify(body.payload, null, 2).slice(0, 4000)}`
        await deps.scheduler.fire({ ...automation, actionPrompt: automation.actionPrompt + context })
        fired.push(automation.id)
      }
    }
    return { ok: true, fired }
  })

  app.get('/api/admin/overview', async (request, reply) => {
    const auth = await requireAdmin(deps, request, reply)
    if (!auth) return
    const [users, tasks, containers] = await Promise.all([
      deps.store.listUsers(),
      Promise.all([
        deps.store.listTasksByStatus('queued'),
        deps.store.listTasksByStatus('running'),
        deps.store.listTasksByStatus('done'),
        deps.store.listTasksByStatus('failed'),
      ]),
      deps.store.listContainers(),
    ])
    const [queued, running, done, failed] = tasks
    return {
      users: users.length,
      tasks: { queued: queued.length, running: running.length, done: done.length, failed: failed.length },
      containers: {
        running: containers.filter((c) => c.state === 'busy' || c.state === 'ready').length,
        idle: containers.filter((c) => c.state === 'idle').length,
        sleeping: containers.filter((c) => c.state === 'sleeping').length,
      },
    }
  })

  app.post('/api/admin/users/:id/quota', async (request, reply) => {
    const auth = await requireAdmin(deps, request, reply)
    if (!auth) return
    const { id } = request.params as { id: string }
    const body = quotaSchema.parse(request.body ?? {})
    const user = await deps.store.getUser(id)
    if (!user) throw new NotFoundError('用户不存在')
    await deps.store.setUserQuota(
      id,
      body.reset
        ? null
        : {
            dailyTokens: body.dailyTokens,
            dailyImages: body.dailyImages,
            dailyVideos: body.dailyVideos,
            maxRunningTasks: body.maxRunningTasks,
          },
    )
    return { ok: true }
  })
}
