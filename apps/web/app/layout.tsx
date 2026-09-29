import type { Metadata } from 'next'
import Link from 'next/link'
import './globals.css'

export const metadata: Metadata = {
  title: 'Wiwana 通用智能体',
  description: '一句话交代任务，云端智能体异步执行，产出文档、表格、幻灯片、网页、图片与视频。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="sticky top-0 z-30 border-b border-[var(--wiwana-line)] bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-[var(--wiwana-brand)] text-sm text-white">W</span>
              Wiwana 智能体
            </Link>
            <nav className="flex items-center gap-4 text-sm text-[var(--wiwana-muted)]">
              <Link href="/" className="hover:text-[var(--wiwana-ink)]">
                任务台
              </Link>
              <Link href="/artifacts" className="hover:text-[var(--wiwana-ink)]">
                交付物
              </Link>
              <Link href="/automations" className="hover:text-[var(--wiwana-ink)]">
                自动化
              </Link>
              <Link href="/login" className="hover:text-[var(--wiwana-ink)]">
                账号
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  )
}
