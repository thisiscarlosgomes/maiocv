import type { NextConfig } from "next";
const config: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/maio-chat",
        destination: "https://portal.maio.cv/api/chat",
      },
    ];
  },
  images: { unoptimized: true },
  transpilePackages: ["maio-ui"],
};
export default config;
