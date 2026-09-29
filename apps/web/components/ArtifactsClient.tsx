'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Artifact, Project } from '@wiwana/protocol'
import { api } from '@/lib/api'
import { ArtifactCard } from '@/components/ArtifactCard'

export function ArtifactsClient() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [artifactResponse, projectResponse] = await Promise.all([api.artifacts(), api.projects()])
      setArtifacts(artifactResponse.artifacts)
      setProjects(projectResponse.projects)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="card p-6">
      <h1 className="text-xl font-semibold">交付物中心</h1>
      <p className="mt-1 text-sm text-[var(--wiwana-muted)]">所有任务产出的文件都在这里，可预览、下载、开启公开分享链接。</p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {artifacts.length === 0 && !error && <p className="text-sm text-[var(--wiwana-muted)]">还没有交付物。</p>}
        {artifacts.map((artifact) => (
          <ArtifactCard key={artifact.id} artifact={artifact} onChange={load} />
        ))}
      </div>
      {projects.length > 0 && (
        <div className="mt-6 border-t border-[var(--wiwana-line)] pt-4">
          <p className="text-xs text-[var(--wiwana-muted)]">按项目打包导出（包含工作区里全部文件，含未在列表显示的中间产物）：</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {projects.map((project) => (
              <a key={project.id} className="btn btn-ghost !px-3 !py-1.5 text-xs" href={api.exportProjectUrl(project.id)}>
                {project.name} ↓
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
