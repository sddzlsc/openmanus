import { SignJWT, jwtVerify } from 'jose'

export interface AuthContext {
  userId: string
  role: 'user' | 'admin'
}

const ISSUER = 'wiwana-control'

export async function signToken(secret: string, context: AuthContext): Promise<string> {
  return new SignJWT({ role: context.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(context.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(new TextEncoder().encode(secret))
}

export async function verifyToken(secret: string, token: string): Promise<AuthContext | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { issuer: ISSUER })
    if (!payload.sub) return null
    return { userId: payload.sub, role: payload.role === 'admin' ? 'admin' : 'user' }
  } catch {
    return null
  }
}
