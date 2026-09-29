import { ShareClient } from '@/components/ShareClient'

export default async function ShareArtifactPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <ShareClient slug={slug} metadataPath="/api/public/artifacts" />
}
