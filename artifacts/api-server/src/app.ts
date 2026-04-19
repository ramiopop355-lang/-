import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(compression());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// ── خدمة ملفات الواجهة الأمامية في الإنتاج ─────────────────────────────
// نبحث في عدة مسارات محتملة (يعمل على Replit autoscale وغيره)
const candidatePaths = [
  process.env["STATIC_DIR"],
  path.join(process.cwd(), "artifacts/sheikh-dhaki/dist/public"),
  path.join(process.cwd(), "../sheikh-dhaki/dist/public"),
  path.join(process.cwd(), "../../sheikh-dhaki/dist/public"),
].filter(Boolean) as string[];

const staticDir = candidatePaths.find((p) => fs.existsSync(p)) ?? candidatePaths[0]!;

if (fs.existsSync(staticDir)) {
  logger.info({ staticDir }, "Serving static frontend files");
  app.use(
    express.static(staticDir, {
      maxAge: "1y",
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html") || filePath.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }),
  );

  // SPA fallback — يُرسل index.html لأي مسار غير API
  app.get(/^\/(?!api).*/, (_req: Request, res: Response, next: NextFunction) => {
    const indexPath = path.join(staticDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
} else {
  logger.warn({ staticDir }, "Static directory not found — frontend will not be served");
}

// ── معالج الأخطاء الشامل — يُرجع JSON دائماً ──────────────────────────
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return;

  // أخطاء Multer (حجم الملف، نوع الملف...)
  if (err instanceof multer.MulterError) {
    const messages: Record<string, string> = {
      LIMIT_FILE_SIZE:   "حجم الملف كبير جداً (الحد الأقصى 15 ميغابايت)",
      LIMIT_FILE_COUNT:  "عدد الملفات تجاوز الحد المسموح",
      LIMIT_FIELD_COUNT: "عدد الحقول تجاوز الحد المسموح",
      LIMIT_UNEXPECTED_FILE: "حقل ملف غير متوقع",
    };
    const msg = messages[err.code] ?? `خطأ في رفع الملف: ${err.message}`;
    logger.warn({ code: err.code }, `[MULTER] ${msg}`);
    return void res.status(400).json({ error: msg });
  }

  // أخطاء مخصصة (fileFilter cb(new Error(...)))
  if (err instanceof Error) {
    logger.error({ message: err.message, stack: err.stack }, "[APP-ERROR]");
    const status = (err as Error & { status?: number }).status ?? 500;
    return void res.status(status).json({ error: err.message || "خطأ في الخادم" });
  }

  // أي خطأ آخر
  logger.error({ err }, "[APP-ERROR-UNKNOWN]");
  return void res.status(500).json({ error: "خطأ غير متوقع في الخادم" });
});

export default app;
