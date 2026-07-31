/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Service worker + manifest are served from /public and must never be cached hard.
  async headers() {
    return [
      { source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] },
      { source: '/manifest.webmanifest', headers: [{ key: 'Content-Type', value: 'application/manifest+json' }] },
    ];
  },
};
export default nextConfig;
