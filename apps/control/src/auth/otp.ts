import type { Store } from '../store/types.js'

const OTP_TTL_MS = 5 * 60 * 1000

export interface OtpSender {
  send(phone: string, code: string): Promise<void>
}

/** Dev sender: writes the code to the log instead of paying for SMS. */
export class ConsoleOtpSender implements OtpSender {
  async send(phone: string, code: string) {
    console.log(`[otp] ${phone} -> ${code}`)
  }
}

export async function requestOtp(
  store: Store,
  sender: OtpSender,
  phone: string,
  devFixedCode: boolean,
): Promise<{ devCode?: string }> {
  const code = devFixedCode ? '000000' : String(Math.floor(100000 + Math.random() * 900000))
  await store.putOtp(phone, code, Date.now() + OTP_TTL_MS)
  await sender.send(phone, code)
  return devFixedCode ? { devCode: code } : {}
}

export async function verifyOtp(store: Store, phone: string, code: string): Promise<boolean> {
  const record = await store.takeOtp(phone)
  if (!record) return false
  if (record.expiresAt < Date.now()) return false
  return record.code === code
}
