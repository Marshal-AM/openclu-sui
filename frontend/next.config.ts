import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const patchedBcsReader = path.resolve(__dirname, "src/lib/bcs-shim/patched-reader.mjs");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
  serverExternalPackages: ["ffmpeg-static", "@xenova/transformers", "onnxruntime-node"],
  webpack: (config, { webpack: wp }) => {
    config.plugins = [
      ...(config.plugins ?? []),
      new wp.NormalModuleReplacementPlugin(
        /[\\/]@mysten[\\/]bcs[\\/]dist[\\/](esm|cjs)[\\/]reader\.(mjs|js)$/,
        patchedBcsReader,
      ),
    ];
    return config;
  },
};

export default nextConfig;
