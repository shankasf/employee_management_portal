/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  webpack: (config) => {
    // Suppress webpack cache warnings related to Windows path casing
    config.infrastructureLogging = {
      level: "error",
    };
    return config;
  },
};

export default nextConfig;
