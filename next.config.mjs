/** @type {import('next').NextConfig} */
const nextConfig = {
  // Aggressive cache headers for 3D model assets.
  // On Firebase Hosting CDN, these get cached at edge nodes globally.
  // Browser also caches them — repeat visits load instantly.
  async headers() {
    return [
      {
        source: '/:path*.glb',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/:path*.gltf',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
