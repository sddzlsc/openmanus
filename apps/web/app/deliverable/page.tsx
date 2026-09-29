import { ShareClient } from '@/components/ShareClient'

/**
 * Public deliverable page. The slug travels as a query parameter because
 * content blockers reject opaque share prefixes (`/s/`, `/share/`, `/pub/`) at
 * the navigation level, before the app ever loads.
 */
export default async function DeliverablePage({
  searchParams,
}: {
  searchParams: Promise<{ slug?: string }>
}) {
  const { slug } = await searchParams
  if (!slug) {
    return <div className="card mx-auto max-w-lg p-8 text-center text-sm text-[var(--wiwana-muted)]">缺少分享参数</div>
  }
  return <ShareClient slug={slug} metadataPath="/api/public/artifacts" />
}
