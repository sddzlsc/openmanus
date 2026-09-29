import type { NextConfig } from 'next'

const controlApi = process.env.CONTROL_API_URL ?? 'http://127.0.0.1:8787'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the production image (deploy/web/Dockerfile).
  output: 'standalone',
  // The control plane owns auth cookies and the SSE event stream; the browser
  // talks to it through this same-origin proxy so cookies stay first-party.
  // NOTE: rewrite destinations are baked at build time, so the image build sets
  // CONTROL_API_URL (default: the compose service name `control`).
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${controlApi}/api/:path*` },
      { source: '/files/:path*', destination: `${controlApi}/files/:path*` },
      { source: '/preview/:path*', destination: `${controlApi}/preview/:path*` },
      { source: '/healthz', destination: `${controlApi}/healthz` },
    ]
    // NOTE: `/s/*`, `/pub/*` and `/share/*` are deliberately NOT rewritten.
    // Those are app pages (ShareClient); rewriting them to the control plane
    // made the browser show the raw metadata JSON instead of the page. The page
    // fetches its data from `/api/public/artifacts/:slug` instead.
  },
}

export default nextConfig
