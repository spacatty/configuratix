import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactCompiler: true,
  // Docker builds ship the self-contained server (`node server.js`); plain `pnpm start` is unaffected.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Anchor bundler resolution to this app when deploy layout infers the repo root
  // (e.g. /opt/.../configuratix) instead of frontend/, which breaks @import "tailwindcss".
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
