/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the whole app runs in the browser; all game logic runs in Lambda.
  output: "export",
  images: { unoptimized: true },
};

module.exports = nextConfig;
