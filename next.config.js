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
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://apis.google.com https://www.gstatic.com",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "font-src 'self' https://fonts.gstatic.com",
              "img-src 'self' data: blob: https://firebasestorage.googleapis.com https://lorestream-3325c.firebasestorage.app https://storage.googleapis.com",
              "media-src 'self' blob: data:",
              "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com wss://*.googleapis.com https://*.pinecone.io https://*.svc.pinecone.io",
              "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
            ].join('; '),
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
