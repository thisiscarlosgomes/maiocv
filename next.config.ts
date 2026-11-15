import type { NextConfig } from "next";
const config: NextConfig = {
  images: { formats: ["image/webp"] },
  async headers() {
    return [{
      source: "/sw.js",
      headers: [
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    }];
  },
  transpilePackages: ["maio-ui"],
};
export default config;
