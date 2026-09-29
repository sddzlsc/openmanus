import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { NotImplementedError } from '../lib/errors.js'
import { requestOtp, verifyOtp } from '../auth/otp.js'
import { signToken } from '../auth/tokens.js'
import { AUTH_COOKIE, authenticate, type RouteDeps } from '../routeDeps.js'

const phoneSchema = z.object({ phone: z.string().regex(/^1\d{10}$/, '请输入 11 位手机号') })
const verifySchema = phoneSchema.extend({ code: z.string().min(4).max(8) })

export async function registerAuthRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post('/api/auth/phone/request-code', async (request) => {
    const { phone } = phoneSchema.parse(request.body ?? {})
    const result = await requestOtp(deps.store, deps.otpSender, phone, deps.config.devAllowFixedOtp)
    return { ok: true, ...result }
  })

  app.post('/api/auth/phone/verify', async (request, reply) => {
    const { phone, code } = verifySchema.parse(request.body ?? {})
    const valid = await verifyOtp(deps.store, phone, code)
    if (!valid) {
      return reply.code(400).send({ error: { code: 'invalid_code', message: '验证码错误或已过期' } })
    }
    const user = (await deps.store.getUserByPhone(phone)) ?? (await deps.store.createUser({ phone }))
    const token = await signToken(deps.config.jwtSecret, { userId: user.id, role: user.role })
    reply.setCookie(AUTH_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 3600,
    })
    return { user, token }
  })

  app.post('/api/auth/wechat/start', async () => {
    throw new NotImplementedError(
      '微信扫码登录需要在环境变量中配置 WECHAT_OPEN_APP_ID / WECHAT_OPEN_APP_SECRET 并完成开放平台审核（M3 接入）。',
    )
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(AUTH_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.get('/api/me', async (request, reply) => {
    const auth = await authenticate(deps, request)
    if (!auth) return reply.code(401).send({ error: { code: 'unauthorized', message: '请先登录' } })
    const user = await deps.store.getUser(auth.userId)
    if (!user) return reply.code(401).send({ error: { code: 'unauthorized', message: '账号不存在' } })
    return { user }
  })

  // Bootstrap helper: promote an existing account to admin outside production.
  app.post('/api/auth/dev-promote', async (request, reply) => {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_PROMOTE !== 'true') {
      return reply.code(403).send({ error: { code: 'forbidden', message: '生产环境禁止使用开发接口' } })
    }
    const { phone } = phoneSchema.parse(request.body ?? {})
    const user = await deps.store.getUserByPhone(phone)
    if (!user) return reply.code(404).send({ error: { code: 'not_found', message: '用户不存在' } })
    await deps.store.setUserRole(user.id, 'admin')
    return { ok: true, userId: user.id, role: 'admin' }
  })
}
