// next.config.js
require('dotenv').config({ path: '.env.local' });
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/** @type {import('next').NextConfig} */
module.exports = (phase, { defaultConfig }) => {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  
  return {
    reactStrictMode: true,
    // Enable SWC minification for improved build times
    swcMinify: true,
    
    webpack: (config, { dev, isServer }) => {
      // Keep the chunk size reasonable
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          // Common chunks
          common: {
            name: 'common',
            minChunks: 2,
            priority: 10,
            reuseExistingChunk: true,
          },
          // Vendor chunks (third-party libraries)
          vendors: {
            test: /[\\/]node_modules[\\/]/,
            name(module) {
              // Get the name of the npm package
              const packageName = module.context.match(
                /[\\/]node_modules[\\/](.*?)([\\/]|$)/
              )[1];
              
              // Major vendors go to their own chunk, rest go to vendors
              const majorVendors = ['react', 'react-dom', 'next', 'socket.io-client'];
              if (majorVendors.includes(packageName)) {
                return `vendor-${packageName}`;
              }
              
              return 'vendors';
            },
            priority: 20,
            reuseExistingChunk: true,
          },
          // Game core features
          gameCore: {
            test: /[\\/]src[\\/](lib|components)[\\/]game-core[\\/]/,
            name: 'game-core',
            priority: 15,
            reuseExistingChunk: true,
          },
          // UI components
          ui: {
            test: /[\\/]src[\\/]components[\\/]ui[\\/]/,
            name: 'ui',
            minChunks: 2,
            priority: 5,
            reuseExistingChunk: true,
          },
        },
      };
      
      // For production builds, further optimize bundles
      if (!dev) {
        // Add bundle analyzer in analyze mode
        if (process.env.ANALYZE === 'true') {
          const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
          config.plugins.push(
            new BundleAnalyzerPlugin({
              analyzerMode: 'server',
              analyzerPort: 8888,
              openAnalyzer: true,
            })
          );
        }
        
        // Optimize bundle compression
        config.optimization.minimize = true;
      }
      
      return config;
    },
    
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
};
