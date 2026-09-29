'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@wiwana/protocol'
import { api, reportClientError } from '@/lib/api'

export function LoginClient() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [devCode, setDevCode] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    void api
      .me()
      .then((response) => setUser(response.user))
      .catch(() => setUser(null))
  }, [])

  const requestCode = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await api.requestCode(phone)
      setDevCode(response.devCode ?? null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送失败')
    } finally {
      setBusy(false)
    }
  }

  const verify = async () => {
    setBusy(true)
    setError(null)
    try {
      const response = await api.verifyCode(phone, code)
      setUser(response.user)
      router.push('/')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '登录失败')
    } finally {
      setBusy(false)
    }
  }

  if (user) {
    return (
      <div className="card mx-auto max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">已登录</h1>
        <p className="mt-2 text-sm text-[var(--wiwana-muted)]">
          {user.displayName} · {user.phone ?? '未绑定手机号'}
        </p>
        <button
          className="btn btn-ghost mt-4"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            setNotice(null)
            try {
              await api.logout()
              setUser(null)
            } catch (caught) {
              const message = caught instanceof Error ? caught.message : '退出失败，请重试'
              setNotice(message)
              reportClientError(caught, 'LoginClient.logout')
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '正在退出…' : '退出登录'}
        </button>
        {notice && <p className="mt-3 text-sm text-red-600">{notice}</p>}
      </div>
    )
  }

  return (
    <div className="card mx-auto max-w-md p-6">
      <h1 className="text-lg font-semibold">手机号登录</h1>
      <p className="mt-1 text-xs text-[var(--wiwana-muted)]">
        开发环境验证码固定为 000000；生产环境走阿里云短信，微信扫码登录在 M3 接入。
      </p>
      <input
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="11 位手机号"
        className="mt-4 w-full rounded-xl border border-[var(--wiwana-line)] px-3 py-2 text-sm outline-none focus:border-[var(--wiwana-brand)]"
      />
      <div className="mt-3 flex gap-2">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="验证码"
          className="flex-1 rounded-xl border border-[var(--wiwana-line)] px-3 py-2 text-sm outline-none focus:border-[var(--wiwana-brand)]"
        />
        <button className="btn btn-ghost" onClick={requestCode} disabled={busy || phone.length !== 11}>
          获取验证码
        </button>
      </div>
      {devCode && <p className="mt-2 text-xs text-[var(--wiwana-brand)]">开发环境验证码：{devCode}</p>}
      <button className="btn btn-brand mt-4 w-full" onClick={verify} disabled={busy || !phone || !code}>
        登录 / 注册
      </button>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </div>
  )
}
