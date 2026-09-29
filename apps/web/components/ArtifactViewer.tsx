'use client'

import { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'
import type { Artifact } from '@wiwana/protocol'
import { api } from '@/lib/api'

const MARKDOWN_KINDS = new Set(['doc', 'slides', 'dataset', 'code', 'chart', 'file'])

export function ArtifactViewer({ artifactId }: { artifactId: string }) {
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const detail = await api.artifact(artifactId)
        setArtifact(detail.artifact)
        if (isTextual(detail.artifact.name)) {
          const response = await fetch(`/files/${artifactId}`, { credentials: 'include' })
          if (!response.ok) throw new Error('文件读取失败，可能已被清理')
          setText(await response.text())
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '加载失败')
      }
    })()
  }, [artifactId])

  const html = useMemo(() => {
    if (!text) return null
    if (!artifact || !MARKDOWN_KINDS.has(artifact.kind)) return null
    // Escape raw HTML before parsing so model-authored content can never inject
    // markup into the viewer; only markdown syntax becomes markup.
    const safe = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    return marked.parse(safe, { async: false, gfm: true, breaks: true }) as string
  }, [artifact, text])

  if (error) {
    return <div className="card mx-auto max-w-3xl p-8 text-center text-sm text-red-600">{error}</div>
  }
  if (!artifact) {
    return <div className="card mx-auto max-w-3xl p-8 text-center text-sm text-[var(--wiwana-muted)]">加载中…</div>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{artifact.name}</h1>
          <p className="text-xs text-[var(--wiwana-muted)]">
            {artifact.kind} · {formatSize(artifact.sizeBytes)} · 由 Wiwana 智能体生成
          </p>
        </div>
        <div className="flex gap-2">
          {/\.(md|markdown|txt|html?)$/i.test(artifact.name) && (
            <a className="btn btn-brand" href={`/api/artifacts/${artifact.id}/export.docx`}>
              导出 Word
            </a>
          )}
          <a className="btn btn-ghost" href={artifact.downloadUrl ?? '#'}>
            下载原文件
          </a>
          <a className="btn btn-ghost" href="/artifacts">
            返回交付物
          </a>
        </div>
      </div>
      <article className="card md-view p-8">
        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">{text ?? '（该类型暂不支持在线预览，请下载查看）'}</pre>
        )}
      </article>
    </div>
  )
}

function isTextual(name: string): boolean {
  return /\.(md|markdown|txt|csv|json|html?|css|js|ts|svg)$/i.test(name)
}

function formatSize(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
