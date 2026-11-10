// next.config.js
require('dotenv').config({ path: '.env.local' });

/**
 * Next.js 16 builds with Turbopack, which splits chunks itself; the old webpack splitChunks
 * settings went with the upgrade (#167).
 * @type {import('next').NextConfig}
 */
module.exports = {
  reactStrictMode: true,

  // Configure image optimization
  images: {
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ui-avatars.com',
        port: '',
        pathname: '/api/**',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
};
