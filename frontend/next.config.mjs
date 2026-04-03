import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // Anchor bundler resolution to this app when deploy layout infers the repo root
  // (e.g. /opt/.../configuratix) instead of frontend/, which breaks @import "tailwindcss".
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
