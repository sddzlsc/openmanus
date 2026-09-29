'use client'

import { useState } from 'react'
import type { Artifact } from '@wiwana/protocol'
import { api } from '@/lib/api'

const KIND_LABELS: Record<string, string> = {
  doc: '文档',
  sheet: '表格',
  slides: '幻灯片',
  pdf: 'PDF',
  image: '图片',
  video: '视频',
  audio: '音频',
  website: '网页',
  code: '代码',
  chart: '图表',
  dataset: '数据',
  file: '文件',
}

export function ArtifactCard({ artifact, onChange }: { artifact: Artifact; onChange?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const toggleShare = async () => {
    setBusy(true)
    try {
      const result = await api.shareArtifact(artifact.id, !artifact.shareEnabled)
      setShareUrl(result.shareUrl)
      onChange?.()
    } finally {
      setBusy(false)
    }
  }

  const previewSource = artifact.previewUrl

  return (
    <div className="rounded-xl border border-[var(--wiwana-line)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{artifact.name}</p>
          <p className="mt-0.5 text-[11px] text-[var(--wiwana-muted)]">
            {KIND_LABELS[artifact.kind] ?? artifact.kind} · {formatSize(artifact.sizeBytes)}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <a className="btn btn-ghost !px-3 !py-1.5 text-xs" href={artifact.downloadUrl ?? '#'} target="_blank">
            下载
          </a>
          <button className="btn btn-brand !px-3 !py-1.5 text-xs" onClick={toggleShare} disabled={busy}>
            {artifact.shareEnabled ? '取消分享' : '分享'}
          </button>
        </div>
      </div>

      {(artifact.kind === 'image' || artifact.kind === 'chart') && previewSource ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewSource} alt={artifact.name} className="mt-3 w-full rounded-lg border border-[var(--wiwana-line)]" />
      ) : null}
      {artifact.kind === 'video' && previewSource ? <video src={previewSource} controls className="mt-3 w-full rounded-lg" /> : null}
      {artifact.kind === 'audio' && previewSource ? <audio src={previewSource} controls className="mt-3 w-full" /> : null}
      {(artifact.kind === 'website' || artifact.kind === 'pdf') && previewSource ? (
        <iframe src={previewSource} className="mt-3 h-52 w-full rounded-lg border border-[var(--wiwana-line)]" />
      ) : null}
      {['doc', 'sheet', 'slides', 'dataset'].includes(artifact.kind) && previewSource ? (
        <div className="mt-3 flex items-center gap-3">
          <a className="text-xs text-[var(--wiwana-brand)] underline" href={`/view/${artifact.id}`}>
            在线查看
          </a>
          {/\.(md|markdown|txt)$/i.test(artifact.name) && (
            <a className="text-xs text-[var(--wiwana-brand)] underline" href={`/api/artifacts/${artifact.id}/export.docx`}>
              导出 Word
            </a>
          )}
        </div>
      ) : null}

      {shareUrl && (
        <p className="mt-2 break-all rounded-lg bg-[var(--wiwana-brand-soft)] px-2 py-1 text-[11px] text-[var(--wiwana-brand)]">
          分享链接：{typeof window !== 'undefined' ? `${window.location.origin}${shareUrl}` : shareUrl}
        </p>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
