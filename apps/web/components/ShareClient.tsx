'use client'

import { useEffect, useState } from 'react'
import type { Artifact } from '@wiwana/protocol'

export function ShareClient({
  slug,
  prefix = '/share',
  metadataPath,
}: {
  slug: string
  /** Legacy path-style alias route; the canonical page passes metadataPath instead. */
  prefix?: string
  metadataPath?: string
}) {
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(metadataPath ? `${metadataPath}/${slug}` : `${prefix}/${slug}`)
        if (!response.ok) throw new Error('分享链接不存在或已关闭')
        const body = (await response.json()) as { artifact: Artifact }
        setArtifact(body.artifact)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : '加载失败')
      }
    })()
  }, [slug, prefix, metadataPath])

  if (error) {
    return <div className="card mx-auto max-w-lg p-8 text-center text-sm text-[var(--wiwana-muted)]">{error}</div>
  }
  if (!artifact) {
    return <div className="card mx-auto max-w-lg p-8 text-center text-sm text-[var(--wiwana-muted)]">加载中…</div>
  }

  return (
    <div className="card mx-auto max-w-3xl p-6">
      <p className="text-xs text-[var(--wiwana-muted)]">Wiwana 智能体交付物</p>
      <h1 className="mt-1 text-xl font-semibold">{artifact.name}</h1>
      <div className="mt-4">
        {(artifact.kind === 'website' || artifact.kind === 'pdf') && artifact.previewUrl ? (
          <>
            <iframe src={artifact.previewUrl} className="h-[70vh] w-full rounded-xl border border-[var(--wiwana-line)]" />
            <div className="mt-3 flex gap-3 text-xs">
              <a className="text-[var(--wiwana-brand)] underline" href={artifact.previewUrl} target="_blank">
                在新标签打开
              </a>
              <a className="text-[var(--wiwana-brand)] underline" href={artifact.downloadUrl ?? '#'}>
                下载源文件
              </a>
            </div>
          </>
        ) : artifact.kind === 'image' || artifact.kind === 'chart' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={artifact.previewUrl ?? ''} alt={artifact.name} className="w-full rounded-xl" />
        ) : artifact.kind === 'video' ? (
          <video src={artifact.previewUrl ?? ''} controls className="w-full rounded-xl" />
        ) : (
          <a className="btn btn-brand" href={artifact.downloadUrl ?? '#'}>
            下载文件
          </a>
        )}
      </div>
    </div>
  )
}
