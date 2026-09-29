import { randomUUID, randomBytes } from 'node:crypto'

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}

export function today(now = new Date()): string {
  return now.toISOString().slice(0, 10)
}
