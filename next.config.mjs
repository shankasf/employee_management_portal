/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // PERFORMANCE: Enable React strict mode for better debugging in development
  reactStrictMode: true,

  // PERFORMANCE: Optimize package imports for better tree-shaking
  experimental: {
    optimizePackageImports: ['@supabase/supabase-js', '@supabase/ssr', 'swr'],
  },

  // PERFORMANCE: Add security headers and caching directives
  async headers() {
    return [
      {
        // Apply to all routes
        source: '/:path*',
        headers: [
          // Enable DNS prefetching for faster external resource loading
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          // Prevent MIME type sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Referrer policy for privacy
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // Cache static assets aggressively
        source: '/fonts/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // API routes should not be cached by browsers
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'private, no-cache, no-store, must-revalidate',
          },
        ],
      },
    ]
  },

  // PERFORMANCE: Compression is handled by the server (nginx/cloudflare)
  // but we can optimize images if needed
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },

  webpack: (config) => {
    // Suppress webpack cache warnings related to Windows path casing
    config.infrastructureLogging = {
      level: "error",
    };
    return config;
  },
};

export default nextConfig;
