/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  transpilePackages: [
    '@ledgerhq/errors',
    '@ledgerhq/devices',
    '@ledgerhq/hw-transport',
    '@ledgerhq/hw-transport-webhid',
    '@ledgerhq/hw-transport-webusb',
    '@ledgerhq/logs',
  ],
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

module.exports = nextConfig;
