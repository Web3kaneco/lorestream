/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict React mode for catching bugs early
  reactStrictMode: true,

  // Required for Three.js / WebGL — skip SSR for canvas components
  transpilePackages: ['three'],

  // Image optimization config
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: 'lorestream-3325c.firebasestorage.app',
      },
    ],
  },

  // Suppress Three.js / WebGL warnings in build output
  webpack: (config) => {
    config.externals = [...(config.externals || []), { canvas: 'canvas' }];
    return config;
  },

  // Security headers for production
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(self), geolocation=()',
          },
        ],
      },
      {
        // Allow cross-origin for 3D model files
        source: '/:path*.glb',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
