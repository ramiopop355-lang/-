import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { compression } from "vite-plugin-compression2";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env["PORT"] ?? 5173);
const basePath = process.env["BASE_PATH"] ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    compression({ algorithm: "brotliCompress", exclude: [/\.(br|gz)$/] }),
    compression({ algorithm: "gzip", exclude: [/\.(br|gz)$/] }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@assets": path.resolve(__dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    target: "es2020",
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":   ["react", "react-dom"],
          "vendor-motion":  ["framer-motion"],
          "vendor-math":    ["react-markdown", "remark-math", "rehype-katex", "katex"],
          "vendor-ui":      ["lucide-react", "@radix-ui/react-tooltip", "@tanstack/react-query"],
          "vendor-router":  ["wouter"],
        },
      },
    },
  },
  optimizeDeps: {
    include: ["react", "react-dom", "framer-motion", "lucide-react"],
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
