/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Remotion's bundler/renderer are heavy node-only deps; keep them external
    // so Next doesn't try to bundle them into the server build.
    serverComponentsExternalPackages: [
      "@remotion/bundler",
      "@remotion/renderer",
      "ffmpeg-static",
      "ffprobe-static",
    ],
  },
};

export default nextConfig;
