import { ArtifactViewer } from '@/components/ArtifactViewer'

export default async function ViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ArtifactViewer artifactId={id} />
}
