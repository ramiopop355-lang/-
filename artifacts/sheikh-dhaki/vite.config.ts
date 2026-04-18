import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const isReplit = !!process.env["REPL_ID"];
const port = Number(process.env["PORT"] ?? 5173);
const basePath = process.env["BASE_PATH"] ?? "/";

const replitPlugins: ReturnType<typeof react>[] = [];

if (isReplit && process.env["NODE_ENV"] !== "production") {
  try {
    const { default: runtimeErrorOverlay } = await import("@replit/vite-plugin-runtime-error-modal");
    replitPlugins.push(runtimeErrorOverlay());
  } catch { /* not available outside Replit */ }

  try {
    const { cartographer } = await import("@replit/vite-plugin-cartographer");
    replitPlugins.push(cartographer({ root: path.resolve(__dirname, "..") }) as ReturnType<typeof react>);
  } catch { /* not available outside Replit */ }

  try {
    const { devBanner } = await import("@replit/vite-plugin-dev-banner");
    replitPlugins.push(devBanner() as ReturnType<typeof react>);
  } catch { /* not available outside Replit */ }
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...replitPlugins,
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
