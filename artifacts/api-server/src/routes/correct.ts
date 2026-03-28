import { Router, type IRouter } from "express";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { evaluate } from "mathjs";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── التحقق الرياضي بـ mathjs ──────────────────────────────────────
interface ExprPair {
  student:  string;
  expected: string;
  variable: string;
  context:  string;
}

interface VerifResult extends ExprPair {
  equivalent: boolean | null;
}

function checkEquivalence(expr1: string, expr2: string, variable: string): boolean | null {
  const testPoints = [1, 2, Math.PI, -1, 0.5, 7, 0.1, 3];
  try {
    for (const val of testPoints) {
      const scope: Record<string, number> = { [variable]: val };
      const v1 = evaluate(expr1, scope) as number;
      const v2 = evaluate(expr2, scope) as number;
      if (typeof v1 !== "number" || typeof v2 !== "number" || !isFinite(v1) || !isFinite(v2)) continue;
      if (Math.abs(v1 - v2) > 1e-9) return false;
    }
    return true;
  } catch {
    return null;
  }
}

const EXTRACT_PROMPT = `Look at both images (exercise + student attempt).
Extract up to 5 mathematical expression pairs where the student wrote a result that can be verified.
Return ONLY a valid JSON array — no markdown, no explanation.
Each item: {"student":"expr","expected":"expr","variable":"x","context":"brief label"}
Use JavaScript/mathjs syntax: 2*x+2, (x+1)^2, sqrt(x), log(x), e^x → exp(x).
If the correct expected answer cannot be determined from the exercise, set expected to null.
If no verifiable pairs exist, return [].`;

async function preAnalyze(
  exerciseBase64: string, exerciseMime: string,
  attemptBase64: string,  attemptMime: string,
  apiKey: string
): Promise<string> {
  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: "gemini-2.5-flash",
      generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: "application/json" },
    });
    const raw = await withTimeout(
      model.generateContent([
        { inlineData: { data: exerciseBase64, mimeType: exerciseMime } },
        { inlineData: { data: attemptBase64,  mimeType: attemptMime  } },
        EXTRACT_PROMPT,
      ]),
      18_000
    );
    const pairs = JSON.parse(raw.response.text()) as ExprPair[];
    if (!Array.isArray(pairs) || pairs.length === 0) return "";

    const results: VerifResult[] = pairs
      .filter((p) => p.student && p.expected)
      .map((p) => ({
        ...p,
        equivalent: checkEquivalence(p.student, p.expected, p.variable || "x"),
      }));

    if (results.length === 0) return "";

    const lines = results.map((r) => {
      const mark = r.equivalent === true ? "✅ مكافئ رياضياً" :
                   r.equivalent === false ? "❌ غير مكافئ" : "⚠️ لم يُتحقق";
      return `- ${r.context}: إجابة الطالب \`${r.student}\` مقابل الصحيح \`${r.expected}\` → ${mark}`;
    });

    return `\n\n**[تحقق mathjs تلقائي]:**\n${lines.join("\n")}`;
  } catch {
    return "";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

// ── نظام أولوية المفاتيح: المدفوع أولاً، ثم المجانية ──────────────
function loadPaidKey(): string | null {
  return process.env["GEMINI_API_KEY"] ?? null;
}

function loadFreeKeys(): string[] {
  const keys: string[] = [];
  for (let i = 2; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
  }
  return keys;
}

// ── نظام Cooldown الذكي ──────────────────────────────────────────
// suspended = معطّل نهائياً (403/401)
// cooldownUntil = معطّل مؤقتاً حتى وقت معين
const suspendedKeys  = new Set<string>();
const cooldownUntil  = new Map<string, number>();
let freeKeyIndex = 0;

const RPM_COOLDOWN_MS   = 65_000;   // 65 ثانية عند تجاوز حد الدقيقة
const DAILY_COOLDOWN_MS = 60 * 60 * 1000; // ساعة عند نفاد الحصة اليومية

function isKeyAvailable(key: string): boolean {
  if (suspendedKeys.has(key)) return false;
  const until = cooldownUntil.get(key) ?? 0;
  if (Date.now() < until) return false;
  return true;
}

function setCooldown(key: string, ms: number): void {
  cooldownUntil.set(key, Date.now() + ms);
}

// تنظيف الـ cooldown المنتهية كل 5 دقائق
setInterval(() => {
  const now = Date.now();
  for (const [key, until] of cooldownUntil) {
    if (now >= until) cooldownUntil.delete(key);
  }
}, 5 * 60 * 1000).unref();

function getNextFreeKey(freeKeys: string[]): string | null {
  const active = freeKeys.filter(isKeyAvailable);
  if (active.length === 0) return null;
  const key = active[freeKeyIndex % active.length];
  freeKeyIndex = (freeKeyIndex + 1) % active.length;
  return key;
}

function isFatalError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("403") ||
    err.message.includes("CONSUMER_SUSPENDED") ||
    err.message.includes("suspended") ||
    err.message.includes("401") ||
    err.message.includes("API_KEY_INVALID")
  );
}

function isExhaustedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("429") ||
    err.message.toLowerCase().includes("quota") ||
    err.message.toLowerCase().includes("rate limit") ||
    err.message.toLowerCase().includes("resource_exhausted")
  );
}

function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.message.includes("503") ||
    err.message.includes("500") ||
    err.message.toLowerCase().includes("overloaded") ||
    err.message.toLowerCase().includes("unavailable") ||
    err.message.toLowerCase().includes("network") ||
    err.message.toLowerCase().includes("timeout")
  );
}

async function tryKey<T>(
  key: string,
  label: string,
  fn: (apiKey: string) => Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const value = await fn(key);
      return { ok: true, value };
    } catch (err: unknown) {
      if (isFatalError(err)) {
        console.warn(`[${label}] Key ...${key.slice(-6)} suspended permanently.`);
        suspendedKeys.add(key);
        return { ok: false };
      }
      if (isExhaustedError(err)) {
        const isDaily = (err instanceof Error) &&
          (err.message.toLowerCase().includes("quota") ||
           err.message.toLowerCase().includes("resource_exhausted"));
        const cooldown = isDaily ? DAILY_COOLDOWN_MS : RPM_COOLDOWN_MS;
        console.warn(`[${label}] Key ...${key.slice(-6)} rate limited — cooldown ${cooldown / 1000}s.`);
        setCooldown(key, cooldown);
        return { ok: false };
      }
      if (isRetryableError(err) && attempt < 2) {
        await sleep(1500);
        continue;
      }
      return { ok: false };
    }
  }
  return { ok: false };
}

async function callWithKeyRotation<T>(
  fn: (apiKey: string) => Promise<T>
): Promise<T> {
  const paidKey  = loadPaidKey();
  const freeKeys = loadFreeKeys();

  // المجموعة الكاملة: المدفوع أولاً ثم المجانية — يُستخدم في الوضعين
  const pool = [...(paidKey ? [paidKey] : []), ...freeKeys];
  if (pool.length === 0) throw new Error("لا يوجد مفتاح Gemini API مضبوط");

  const tried = new Set<string>();

  // 1️⃣ المفتاح المدفوع — أولوية قصوى
  if (paidKey && isKeyAvailable(paidKey)) {
    tried.add(paidKey);
    const res = await tryKey(paidKey, "PAID", fn);
    if (res.ok) return res.value;
  }

  // 2️⃣ دوران على كامل المجموعة (المجانية + المدفوع إذا عاد متاحاً)
  for (let i = 0; i < pool.length; i++) {
    const key = pool[(freeKeyIndex + i) % pool.length];
    if (tried.has(key) || !isKeyAvailable(key)) continue;
    tried.add(key);

    const label = key === paidKey ? "PAID" : "FREE";
    const res = await tryKey(key, label, fn);
    if (res.ok) {
      freeKeyIndex = (freeKeyIndex + 1) % pool.length;
      return res.value;
    }
  }

  throw new Error("فشلت كل مفاتيح Gemini API");
}
// ─────────────────────────────────────────────────────────────────

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("يجب رفع ملف صورة فقط"));
  },
});

const SYSTEM_PROMPT = `أنت أستاذ رياضيات جزائري مختص في تصحيح تمارين البكالوريا. ردودك **مختصرة ومباشرة** — بدون حشو أو تكرار.

إذا كان التمرين لا علاقة له بالرياضيات، أخبر الطالب بجملة واحدة.

**قراءة الصور:** اقرأ صورة التمرين وصورة محاولة الطالب. إذا كان جزء غير واضح، افترض السياق المنطقي.

**قواعد التصحيح:**
- استخدم LaTeX لكل تعبير رياضي.
- اتبع المنهجية الجزائرية (جداول الإشارة، T.A.F، البرهان بالتراجع).
- أي تعبير مكافئ رياضياً يُعتبر صحيح حتى لو كان مختلف الشكل.
- تحقق من التحليل بالنشر أو التعويض.
- النتيجة صحيحة بطريقة مختلفة → **صحيح**. خطوات مختصرة → **ناقص** لا خطأ. لا تخترع أخطاء.

**الحكم:** ✔️ صحيح / ⚠️ ناقص / ❌ خطأ — واحدة فقط.

**هيكل الرد (موجز — لا تطوّل):**

📌 **الحكم:** صحيح / ناقص / خطأ

📌 **التصحيح:** أين الخطأ أو النقص — جمل قصيرة فقط.

📌 **الحل النموذجي:** الخطوات الضرورية فقط بدون شرح زائد.

📌 **ملاحظة:** جملة واحدة للتلميذ.

*تمت المعالجة وفق معايير سِيغْمَا Σ — بياناتك مشفرة ومحمية.*`;

router.post(
  "/correct",
  upload.fields([
    { name: "exercise", maxCount: 1 },
    { name: "attempt", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const shoba = (req.body.shoba as string) || "رياضيات";
      const notes = (req.body.notes as string) || "";
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      const exerciseFile = files?.["exercise"]?.[0];
      const attemptFile = files?.["attempt"]?.[0];

      if (!exerciseFile) {
        res.status(400).json({ error: "يجب رفع صورة التمرين" });
        return;
      }
      if (!attemptFile) {
        res.status(400).json({ error: "يجب رفع صورة محاولتك" });
        return;
      }

      const exerciseBase64 = exerciseFile.buffer.toString("base64");
      const exerciseMime = exerciseFile.mimetype || "image/jpeg";
      const attemptBase64 = attemptFile.buffer.toString("base64");
      const attemptMime = attemptFile.mimetype || "image/jpeg";

      // ── التحقق الرياضي المسبق بـ mathjs ──
      const anyKey = loadPaidKey() ?? loadFreeKeys()[0] ?? "";
      const mathjsVerification = anyKey
        ? await preAnalyze(exerciseBase64, exerciseMime, attemptBase64, attemptMime, anyKey).catch(() => "")
        : "";

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");

      const userMessage = `الشعبة: **${shoba}**
${notes ? `ملاحظة الطالب: ${notes}` : ""}

الصورة الأولى: نص التمرين.
الصورة الثانية: محاولة الطالب في حل التمرين.
${mathjsVerification ? `\n**[نتائج التحقق الحسابي التلقائي — استخدمها كمرجع داخلي ثابت]:**${mathjsVerification}\n` : ""}
قيّم محاولة الطالب وفق الهيكل البيداغوجي الإلزامي ومنهاج البكالوريا الجزائرية 2026.`;

      const result = await withTimeout(callWithKeyRotation((apiKey) => {
        const genai = new GoogleGenerativeAI(apiKey);
        const model = genai.getGenerativeModel({
          model: "gemini-2.5-flash",
          systemInstruction: SYSTEM_PROMPT,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
            // @ts-ignore — thinkingConfig is valid but not yet in type defs
            thinkingConfig: { thinkingBudget: 0 },
          },
        });
        return model.generateContentStream([
          { inlineData: { data: exerciseBase64, mimeType: exerciseMime } },
          { inlineData: { data: attemptBase64, mimeType: attemptMime } },
          userMessage,
        ]);
      }), 90_000);

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطأ في الخادم";
      console.error("Correct error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    }
  }
);

export default router;
