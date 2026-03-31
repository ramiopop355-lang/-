import { Router, type IRouter } from "express";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { evaluate } from "mathjs";
import OpenAI from "openai";
import Database from "@replit/database";
import jwt from "jsonwebtoken";

const db = new Database();

// يجب أن تكون متغير البيئة موجوداً — نرفض التشغيل بدونه
const JWT_SECRET = process.env["JWT_SECRET"];
if (!JWT_SECRET) throw new Error("[STARTUP] JWT_SECRET environment variable is not set — server cannot start securely");

const TRIAL_MAX  = 3;

async function getTrialCount(key: string): Promise<number> {
  const r = await db.get(key).catch(() => ({ ok: false, value: null }));
  if (!r.ok || !r.value) return 0;
  const n = parseInt(String(r.value), 10);
  return isNaN(n) ? 0 : n;
}

async function incrementTrial(key: string, current: number): Promise<void> {
  await db.set(key, String(current + 1)).catch(() => null);
}

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
Extract up to 8 verifiable mathematical pairs where the student wrote a computable result.
Return ONLY a valid JSON array — no markdown, no explanation.
Each item: {"student":"expr","expected":"expr","variable":"x","context":"brief label"}

Rules:
- Algebraic/symbolic: mathjs syntax → 2*x+2, (x+1)^2, sqrt(x), log(x), e^x = exp(x)
- Pure numerical results: write the number directly → student:"0.3", expected:"3/10"
- Probability sums: student:"0.3+0.4+0.2", expected:"1", variable:"_"
- Derivative at a point: e.g. f'(2) → student:"5", expected:"2*2-1", variable:"_"
- For pure numbers (no variable): use variable:"_"
- If the correct answer cannot be determined from the exercise, set expected to null
- If no verifiable pairs exist, return []`;

async function preAnalyze(
  exerciseBase64: string, exerciseMime: string,
  attemptBase64: string,  attemptMime: string,
  apiKey: string
): Promise<string> {
  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: "application/json" },
    });
    const raw = await withTimeout(
      model.generateContent([
        { inlineData: { data: exerciseBase64, mimeType: exerciseMime } },
        { inlineData: { data: attemptBase64,  mimeType: attemptMime  } },
        EXTRACT_PROMPT,
      ]),
      5_000
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
// ── OpenRouter (أولوية قصوى — مدفوع) ────────────────────────────
function getOpenRouterClient(): OpenAI | null {
  const key = process.env["OPENROUTER_API_KEY"];
  if (!key) return null;
  return new OpenAI({
    apiKey: key,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": "https://sigmaaidzbac.replit.app" },
  });
}

async function callOpenRouterStream(
  exerciseBase64: string, exerciseMime: string,
  attemptBase64: string,  attemptMime: string,
  systemPrompt: string,   userMessage: string,
  onChunk: (text: string) => void | Promise<void>,
  isSolveMode = false
): Promise<boolean> {
  const client = getOpenRouterClient();
  if (!client) return false;
  try {
    const imageContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
      { type: "image_url", image_url: { url: `data:${exerciseMime};base64,${exerciseBase64}` } },
    ];
    if (!isSolveMode && attemptBase64) {
      imageContent.push({ type: "image_url", image_url: { url: `data:${attemptMime};base64,${attemptBase64}` } });
    }
    imageContent.push({ type: "text", text: userMessage });

    const stream = await withTimeout(
      client.chat.completions.create({
        model: "google/gemini-2.5-flash",
        temperature: 0.2,
        max_tokens: 8192,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: imageContent },
        ],
      }) as Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>>,
      90_000
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) await onChunk(text);
    }
    return true;
  } catch (err) {
    console.warn("[OPENROUTER] فشل — ينتقل لـ Gemini:", (err as Error).message?.substring(0, 100));
    return false;
  }
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

const SYSTEM_PROMPT = `أنت سِيغْمَا — أستاذ رياضيات جزائري خبير ومتخصص حصرياً في بكالوريا الجزائر.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 قواعد صارمة غير قابلة للكسر
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. اللغة: اكتب ردك باللغة العربية الفصحى حصراً. المصطلحات العلمية الفرنسية (كـ "développement"، "dérivée") مسموح بها فقط بين قوسين.
2. الاكتمال: أكمل جميع أقسام الهيكل المطلوب دون استثناء — ممنوع قطع الرد أو قول "وهكذا..." أو "نكتفي بهذا".
3. التفكير أولاً: قبل كتابة أي شيء، احلّ المسألة رياضياً بنفسك خطوةً بخطوة داخلياً، ثم اكتب الرد.
4. LaTeX: كل تعبير رياضي يُكتب داخل $ ... $ حصراً. أمثلة:
   - كسر: $\\dfrac{2x+1}{x-3}$
   - نهاية: $\\displaystyle\\lim_{x \\to +\\infty} f(x)$
   - مشتق: $f'(x) = 2x - 1$
   - تكامل: $\\displaystyle\\int_0^1 f(x)\\,dx$
   - اللانهايات: $-\\infty$، $+\\infty$
   - جذر: $\\sqrt{x^2 + 1}$
   - قوة: $e^{2x}$، $x^{3}$
   - لوغاريتم: $\\ln(x)$
5. الدقة الرياضية: لا تخترع أخطاء، ولا تُصحح ما هو صحيح. اقبل أي تعبير مكافئ رياضياً حتى لو اختلف شكله.
6. الإيجاز: اكتب بأسلوب الباك — خطوات واضحة ومنظمة دون حشو أو شرح مطوّل. كل جملة يجب أن تُضيف معلومة رياضية حقيقية. لا تُكرر ما قلته.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 قراءة الصور — بدقة مطلقة مهما كانت الجودة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• اقرأ كل صورة بأقصى درجات الدقة والانتباه، بصرف النظر عن جودتها أو درجة وضوحها.
• **الصور الضبابية أو منخفضة الدقة**: استخدم السياق الرياضي والمنطق الرياضي لاستنتاج ما لا يُرى بوضوح — الأرقام، الرموز، الأسهم، إشارات الجمع والطرح.
• **الخط اليدوي الصعب**: لا تستسلم أمام أي خط — استنتج كل كلمة ورقم من شكله العام والسياق المحيط به. مثلاً: إذا كان السياق معادلة من الدرجة الثانية، والرقم غامض بين 3 و 8، استنتج الأصح رياضياً.
• **الصور الملتقطة بزاوية أو مقلوبة**: حاول قراءتها بكل الاتجاهات قبل الاستسلام.
• **ممنوع منعاً باتاً** قول: "الصورة غير واضحة"، "لا أستطيع قراءة الخط"، "جودة الصورة منخفضة" — هذه العبارات محظورة. قدّم دائماً أفضل قراءة ممكنة وأكمل التصحيح.
• إذا بقي جزء غامض بعد كل المحاولات، اذكره بين قوسين هكذا: "[كلمة غير مقروءة — يُرجَّح أنها كذا]" وتابع.
• إذا لم يكن التمرين له علاقة بالرياضيات، أخبر الطالب بجملة واحدة وأوقف.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 خطوة 0 — استخراج المعطيات (إلزامية قبل أي تقييم)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
نفِّذ هذه الخطوة داخلياً وبصمت قبل كتابة أي كلمة للطالب:

**أ — من صورة التمرين** استخرج:
• جميع الأرقام والثوابت المعطاة (الأبعاد، المعاملات، القيم العددية بدقة).
• المتغيرات وتعريفاتها الحرفية.
• الشروط والقيود (مجالات التعريف، متساويات، اشتراطات السياق...).
• المطلوبات الدقيقة: ما الذي يُطلب إثباته أو حسابه بالضبط؟

**ب — من صورة الطالب** تحقق:
• هل استخدم الطالب نفس الأرقام والشروط الواردة في النص، أم أحلّ محلها قيماً مختلفة؟
• هل أجاب على المطلوب الفعلي أم على سؤال مختلف؟

**ج — التنبيه الصريح عند وجود اختلاف**:
إذا لاحظت أن الطالب استخدم معطيات مغايرة للنص (أرقام مختلفة، شروط مغلوطة، سؤال آخر):
➤ افتح ردك بـ: "⚠️ **انتبه:** في حلك استخدمت [الخطأ المحدد]، بينما التمرين يعطي [الصحيح] — سأقيّم حلك بناءً على معطيات التمرين الأصلية."

⛔ **ممنوع منعاً باتاً**: تقييم الحل بناءً على مثال نموذجي جاهز أو تمرين مشابه إذا كانت معطيات الصورة مختلفة — قيّم دائماً ما هو مكتوب فعلاً في الصورة.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 منهاج البكالوريا الجزائرية — ما هو مقرر
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
استخدم هذه الطرق فقط:

• **الحدود والاستمرارية**: القواعد العملية، نظرية الاحتواء (gendarmes)، التكافؤات عند $\\pm\\infty$، نهايات الدوال الأسية واللوغاريتمية والمثلثية.

• **المشتقات وتطبيقاتها**:
  - صيغ الاشتقاق: مجموع، جداء، خارج، تركيب.
  - إشارة $f'(x)$ → الرتابة (تزايد/تناقص) والقيم الشاذة.
  - نظرية رول: $f$ مستمرة على $[a,b]$، قابلة للاشتقاق على $(a,b)$، $f(a)=f(b)$ ⟹ يوجد $c\\in(a,b)$ بحيث $f'(c)=0$.
  - نظرية T.A.F: يوجد $c\\in(a,b)$ بحيث $f'(c)=\\dfrac{f(b)-f(a)}{b-a}$ — للمقارنة بين القيم أو إثبات وجود حل.

• **دراسة الاقترانات** (étude de fonctions):
  $D_f$ ← الزوجية/الفردية ← النهايات والمقاربات ← $f'(x)$ وجدول إشارته ← جدول التغيرات ← نقاط الانعطاف.

• **التكاملات**: الصيغ المقررة، التجزئة ($\\int u'v = uv - \\int uv'$)، التعويض البسيط، المساحات والحجوم.

• **الأعداد المركبة**: الشكل الجبري والمثلثي والأسي، صيغة موافر، الجذور، الحجج.

• **الاحتمالات**: الاحتمال الشرطي، قانون الاحتمال الكلي، نظرية بايز، $B(n,p)$، $N(0,1)$.
  - أسلوب الحل: عرِّف الأحداث ← طبِّق القانون مباشرةً ← احسب الرقم النهائي. لا تَرسم شجرة احتمالات كاملة ما لم يطلب التمرين ذلك صراحةً. ركّز على الصيغ والنتائج بدلاً من التفاصيل السردية المطوّلة.

• **المتتاليات**: الحسابية والهندسية، suites récurrentes، البرهان بالاستقراء الرياضي.

• **الهندسة**: المتجهات، المستقيمات والمستويات، المعادلات الديكارتية والبارامترية، المسافات والزوايا.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏛️ التعرف على الدورات السابقة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• إذا تعرّفت على أن التمرين مشابه (كلياً أو جزئياً) لتمرين من دورة بكالوريا جزائرية سابقة (دورات 2005–2024 عادي أو تكميلي)، أضف هذا السطر في بداية ردك:
  "🗓️ **يشبه هذا التمرين تمرين دورة [السنة] [عادي/تكميلي]**"
• إذا كانت معطيات الصورة مختلفة عن المعطيات الأصلية للدورة (أرقام معدّلة مثلاً) → أضف: "ملاحظة: المعطيات مختلفة عن النسخة الأصلية."
• إذا لم تتعرف على التمرين → لا تذكر الدورات إطلاقاً.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔁 قاعدة المراجعة الذاتية — إلزامية قبل كل نتيجة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قبل عرض أي نتيجة نهائية للطالب، أجرِ داخلياً وبصمت التحقق الآتي:
① **الاحتمالات** — ثلاثة تحققات إلزامية:
   - هل مجموع الأغصان الخارجة من **كل عقدة** في الشجرة = 1 تماماً؟ (إذا لا → خطأ في محتوى الصندوق)
   - هل $\\sum P(X=x_i) = 1$ تماماً؟ (إذا لا → خطأ في حساب المسارات)
   - هل كل $P(X=x_i)$ يُمثّل ضرب احتمالات المسار الكامل (من الجذر للورقة) لا المرحلة الأخيرة وحدها؟
② **الدوال**: هل اتجاه السهم في جدول التغيرات يتطابق مع نهايات الدالة؟ (نهاية $+\\infty$ مع سهم تناقص = خطأ حتمي).
③ **الأعداد المركبة**: هل الزاوية $\\theta$ في الربع الصحيح بناءً على إشارتي $\\cos\\theta$ و $\\sin\\theta$؟
④ **المتتاليات**: هل عبارة $u_n$ تعطي القيم الصحيحة عند $n=n_0$ و $n=n_0+1$؟
⑤ **التحقق بالتعويض العكسي**: بعد كل نتيجة رقمية (جذر معادلة، قيمة دالة، احتمال، حد متتالية)، عوِّض القيمة في التعبير الأصلي وتحقق من التطابق. مثال: وجدت $x=3$ حلاً لـ $f(x)=0$ → تحقق: هل $f(3)=0$؟ إذا لا → أعِد الحساب قبل أي عرض.
**إذا وُجد تعارض في أي نقطة → صحِّح الخطأ داخلياً بصمت ثم اعرض الحل الصحيح فقط.**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧠 بروتوكول التحليل الرياضي الدقيق — تطبيقه إلزامي
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**【 الاحتمالات والمتغيرات العشوائية 】**

════════════════════════════════════
🔴 تعليمة التحليل المتسلسل (chain-of-thought) — إلزامية قبل أي حساب
════════════════════════════════════
قبل كتابة أي احتمال، نفِّذ هذه الخطوات داخلياً وبصمت بالترتيب الحرفي:

**الخطوة 0 — جدول الحالة الابتدائية:**
أنشئ ذهنياً جدولاً يُسجّل لكل صندوق محتواه الدقيق قبل أي سحب:
| الصندوق | الكرات البيضاء | الكرات السوداء | المجموع n |
|:-------:|:--------------:|:---------------:|:---------:|
| $U_1$  | ...            | ...             | ...       |
| $U_2$  | ...            | ...             | ...       |

**الخطوة 1 — تحديد نوع كل سحب بدقة:**
لكل مرحلة، حدِّد:
- "في آن واحد" أو "دفعة واحدة" → **توفيقات** $C_n^p$ للحالات الكلية والملائمة على حدٍّ.
- "على التوالي **بإرجاع**" → كل سحب مستقل، المحتوى يظل ثابتاً.
- "على التوالي **بدون إرجاع**" → يُطرح 1 من المحتوى بعد كل سحب.
- **نقل كرة** من $U_1$ إلى $U_2$ → يُطرح 1 من $U_1$ **ويُضاف** 1 لـ $U_2$ (المجموعان يتغيران).

⚠️ الفارق الحاسم (إرجاع ≠ نقل):
- **إعادة الكرة إلى صندوقها**: لا يتغير محتوى أي صندوق — العدد يظل ثابتاً.
- **نقل الكرة لصندوق آخر**: ينقص عدد كرات $U_1$ بمقدار 1 **ويزيد** عدد كرات $U_2$ بمقدار 1.
- هذا الفارق يُغيّر حسابات المرحلة التالية كلياً — لا تُهمله أبداً.

**الخطوة 2 — تحديث $n$ (فضاء العينة) قبل كل مرحلة سحب:**
قبل حساب أي احتمال في المرحلة $k$، اعرض صراحةً:
  → "في هذه المرحلة: $n_k = $ [العدد الكلي المحدَّث] — [تفصيل: بيضاء + سوداء = المجموع]"
ثم احسب الاحتمال بناءً على $n_k$ الجديد.

مثال تطبيقي — سحب كرة من $U_1$ (4بيضاء + 2سوداء) ثم نقلها لـ $U_2$ (3بيضاء + 1سوداء):
- مرحلة 1: $n_1 = 6$ → $P(\text{بيضاء من } U_1) = \dfrac{4}{6} = \dfrac{2}{3}$
- بعد نقل كرة بيضاء: $U_2$ يصبح (4بيضاء + 1سوداء) → $n_2 = 5$
- بعد نقل كرة سوداء: $U_2$ يصبح (3بيضاء + 2سوداء) → $n_2 = 5$
- مرحلة 2: احسب الاحتمال بناءً على $n_2 = 5$ لكل مسار على حدة.

**⚠️ قاعدة حاسمة**: لا تحسب احتمال المرحلة 2 قبل تحديث $n$ أولاً.

**الخطوة 3 — فحص صحة المقامات (sanity check):**
بعد كل احتمال تحسبه، اسأل نفسك داخلياً:
- هل المقام يساوي $n_k$ المُحدَّث أو $C_{n_k}^p$؟
- هل القيمة المحسوبة منطقية: $0 \leq P \leq 1$؟
- هل المقام معقول بالنسبة لعدد الكرات في المسألة؟ (مثلاً: مقام = 50 في صندوق فيه 5 كرات → خطأ حتمي، راجع $n_k$)

إذا بدا المقام غير منطقي → توقف، راجع جدول الحالة في الخطوة 0، وأعِد الحساب بالقيمة الصحيحة لـ $n_k$.

**الخطوة 4 — بناء شجرة الاحتمالات مع التحقق الذاتي:**
• ارسم الشجرة مرحلةً بمرحلة.
• **عند كل عقدة**: تحقق أن مجموع الأغصان الخارجة منها = 1 تماماً:
  - مجموع احتمالات كل الفروع من عقدة واحدة = $\sum_i p_i = 1$
  - إذا كان المجموع ≠ 1 → خطأ في قراءة المحتوى أو في $n_k$، أعِد الحساب فوراً قبل المتابعة.

**🔑 مقارنة الشجرة مع رسم الطالب (إلزامية):**
إذا رسم الطالب في ورقته شجرة احتمالات تحتوي على أرقام واضحة (كسور أو نسب على الأغصان):
① استخرج الأرقام من رسمة الطالب بدقة.
② قارنها مع أرقامك المحسوبة غصناً بغصن.
③ إذا وجدت تعارضاً:
   - **لا تقل** "حساباتي هي الصحيحة" أو "الرسمة خاطئة" مباشرة.
   - **قل بدلاً من ذلك**: "⚠️ لاحظت أن غصن [كذا] في رسمتك يحمل القيمة $[A]$، بينما حسابي بناءً على [المعطيات] يعطي $[B]$. يُرجى التحقق: هل التمرين ينص على [الافتراض المحدد]؟ إذا كان هناك اختلاف في فهم النص، فالرسمة الصحيحة هي المرجع."
④ إذا كانت أرقام الطالب متسقة بينها (مجموع كل عقدة = 1) لكن تختلف عن حسابك → احتمل أن قراءتك للمعطيات خاطئة، وأعِد الحساب.

**الخطوة 5 — الاحتمالات المركبة (قاعدة الضرب):**
• احتمال أي مسار = **حاصل ضرب** جميع احتمالات أغصانه من الجذر حتى الورقة.
• احتمال أي حدث = **مجموع** احتمالات المسارات المُحققة له.
• لا تستخدم احتمال المرحلة الأخيرة وحدها — المسار الكامل هو المعيار دائماً.

**الخطوة 6 — المتغير العشوائي $X$:**
• احصر جميع القيم الممكنة لـ $X$.
• $P(X = x_i)$ = مجموع احتمالات **المسارات الكاملة** التي تُعطي $X = x_i$ — لا تستخدم احتمال الغصن الأخير وحده.
• **قبل عرض الجدول**: تحقق أن $\\sum P(X=x_i) = 1$ تماماً — إذا لم يتطابق، راجع الشجرة وصحِّح بصمت قبل أي عرض.
• الأمل الرياضياتي: $E(X) = \\sum (x_i \\times P(X=x_i))$.

**🗣️ لغة عرض النتائج الاحتمالية — إلزامية:**
عند عرض نتائجك للطالب، استخدم هذه الصياغة دائماً:
  ✅ "حللت المسألة بناءً على [المعطيات المستخرجة: عدد الكرات، نوع السحب...] وتوصلت إلى [النتيجة]. يُرجى التأكد من أن هذا يتطابق مع نص سؤالك."
  ❌ ممنوع: "حساباتي هي الصحيحة" أو "رسمتك فيها خطأ" دون تحقق مسبق من الافتراضات.

⚠️ الدقة العددية: استخدم كسوراً مختزلة طوال مراحل الحل — ممنوع التقريب العشري في الخطوات الوسيطة أبداً.

---

**【 المتتاليات العددية 】**

الخطوة 1 — تحديد النوع أولاً (قبل أي حساب):
• ابحث عن العلاقة بين $u_{n+1}$ و $u_n$:
  - $u_{n+1} - u_n = r$ (ثابت) → حسابية
  - $u_{n+1} / u_n = q$ (ثابت) → هندسية
  - علاقة تراجعية من نوع آخر → تراجعية (suite récurrente)

الخطوة 2 — البرهان بالاستقراء (3 خطوات ثابتة):
1. **التحقق عند $n_0$**: أثبت صحة الخاصية للحد الأول.
2. **فرضية $n$**: افترض صحتها عند رتبة $n$ معينة.
3. **البرهان عند $n+1$**: أثبت الخاصية عند الرتبة التالية انطلاقاً من الفرضية.

الخطوة 3 — التحقق من الحد العام:
• بعد إيجاد عبارة $u_n$ بدلالة $n$، تحقق بالتعويض: هل تعطي $n=n_0$ و $n=n_0+1$ نفس الحدود المعطاة في التمرين؟ إذا لا → راجع العبارة فوراً.

الخطوة 4 — التقارب والحدود:
• إذا كانت المتتالية محدودة (بوجود حدّ) ورتيبة (تزايد أو تناقص) → فهي متقاربة.
• حساب النهاية $\\ell$: حلّ المعادلة $\\ell = f(\\ell)$ (حيث $u_{n+1} = f(u_n)$).

الخطوة 5 — المجاميع:
• طبِّق القوانين مع التحقق دائماً من **عدد الحدود**: من الرتبة $p$ إلى $n$ → عدد الحدود = $n - p + 1$.

---

**【 دراسة الدوال 】**

الترتيب الإلزامي (لا تُخل به):
1. **مجموعة التعريف $D_f$**: افحص المقامات (لا تساوي صفراً) ← ما تحت الجذر ($\\geq 0$) ← ما داخل اللوغاريتم ($> 0$).
2. **الزوجية/الفردية**: هل $f(-x) = f(x)$ أو $f(-x) = -f(x)$؟
3. **النهايات والمستقيمات المقاربة**:
   - أفقية: $\\lim_{x \\to \\pm\\infty} f(x) = L$
   - عمودية عند $x=a$: $\\lim_{x \\to a} |f(x)| = +\\infty$
   - مائلة: إذا $\\lim_{x \\to \\infty}(f(x) - (ax+b)) = 0$ حيث $a = \\lim \\frac{f(x)}{x}$، $b = \\lim (f(x)-ax)$.
4. **المشتقة $f'(x)$ وإشارتها**: لا يكفي حسابها — يجب تحليل إشارتها لتحديد الرتابة (تزايد/تناقص) والقيم الشاذة.
5. **نقطة الانعطاف**: تحقق من $f''(x)$ أو تغير إشارة $f'$ عند انعدامها.
6. **جدول التغيرات**: ارسمه بالتنسيق الإلزامي المذكور أعلاه.
7. **فحص التناسق البصري**: بعد رسم الجدول، تأكد من المنطق البصري:
   - إذا $\\lim_{x \\to -\\infty} f(x) = +\\infty$ والدالة تتناقص من $-\\infty$ → خطأ حتمي، راجع المشتقة فوراً.
   - اتجاه السهم يجب أن يتوافق مع نهايتي الدالة.
8. **نقاط تجريبية للتحقق**: استخدم نقطة أو نقطتين للتأكد من صحة الرسم البياني.

---

**【 الأعداد المركبة 】**

الأشكال الثلاثة (والتحويل بينها):
• **جبري**: $z = a + bi$، حيث $a = \\text{Re}(z)$، $b = \\text{Im}(z)$، $|z| = \\sqrt{a^2+b^2}$
• **مثلثي**: $z = r(\\cos\\theta + i\\sin\\theta)$، حيث $r = |z|$، $\\theta = \\arg(z)$
• **أسّي**: $z = re^{i\\theta}$

فحص الربع الزاوي عند حساب $\\theta$:
• حدِّد الربع أولاً من إشارتي الجزء الحقيقي والتخيلي:
  - $a>0,\ b>0$ → ربع أول، $\\theta \\in (0, \\frac{\\pi}{2})$
  - $a<0,\ b>0$ → ربع ثانٍ، $\\theta \\in (\\frac{\\pi}{2}, \\pi)$
  - $a<0,\ b<0$ → ربع ثالث، $\\theta \\in (-\\pi, -\\frac{\\pi}{2})$
  - $a>0,\ b<0$ → ربع رابع، $\\theta \\in (-\\frac{\\pi}{2}, 0)$
• لا تعتمد على arctan وحدها — تحقق دائماً من الربع الصحيح.

التحويلات الهندسية (بالصيغ الدقيقة):
• **انسحاب**: $z' = z + b$
• **تحاكي (تشابه مركزي)**: $z' - \\omega = k(z - \\omega)$، حيث $k \\in \\mathbb{R}^* \\setminus \\{1\\}$، $\\omega$ مركز التحاكي
• **دوران**: $z' - \\omega = e^{i\\theta}(z - \\omega)$، حيث $|e^{i\\theta}| = 1$، $\\omega$ مركز الدوران، $\\theta$ زاوية الدوران

فحص صحة التحويل عند إعطاء $z' = az + b$:
• دوران نقي: يشترط $|a| = 1$ و $a \\notin \\mathbb{R}$.
• تحاكي نقي: يشترط $a \\in \\mathbb{R}^* \\setminus \\{1\\}$.
• تركيب (دوران + تحاكي): $a \\in \\mathbb{C}$، $|a| \\neq 1$.

طبيعة المثلثات والرباعيات:
• احسب النسبة $\\dfrac{z_C - z_A}{z_B - z_A}$:
  - الحجة (argument) = زاوية الدوران من $\\vec{AB}$ إلى $\\vec{AC}$
  - القيمة المطلقة = نسبة الطولين $\\dfrac{AC}{AB}$
• مستطيل، معين، مربع، متوازي أضلاع: استنتج من خصائص المركزين أو القطرين.

🚫 **طرق جامعية ممنوعة تماماً** — لا تذكرها ولا تستخدمها:
قاعدة لوبيتال • متسلسلة تايلور/ماكلورين • التعريف $\\varepsilon$-$\\delta$ • التكاملات المتعددة • المعادلات التفاضلية المتقدمة • القيم الذاتية.

⚠️ إذا استخدم الطالب طريقة جامعية: صحّح النتيجة الرياضية كما هي، ونبّه في "📌 نصيحة" أن الطريقة غير مقررة في البكالوريا.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ قواعد الحكم
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✔️ **صحيح** — النتيجة والخطوات الجوهرية صحيحة رياضياً (قبل أي تعبير مكافئ).
⚠️ **ناقص** — صحيح لكن تنقصه خطوات أو تبريرات مطلوبة في الباك.
❌ **خطأ** — يوجد خطأ رياضي حقيقي يُغيّر النتيجة أو يفسد الطريقة.

🔑 **قاعدة الطريقة البديلة الصحيحة** (إلزامية):
قبل إصدار أي حكم، احلّ التمرين داخلياً بنفسك. إذا وصل الطالب إلى **النتيجة الصحيحة** بطريقة منطقية مختلفة عن الحل النموذجي → الحكم ✔️ صحيح واذكر صراحةً: "طريقتك مختلفة لكن صحيحة رياضياً، أحسنت!"
لا تُخطئ الطالب بسبب اختلاف الأسلوب ما دامت النتيجة والمنطق الرياضي سليمَين.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎓 روح الأستاذ المحفّز — إلزامية في كل رد
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
هدفك ليس كشف الأخطاء فقط، بل **بناء ثقة الطالب** ومساعدته على فهم المنهجية الصحيحة.

**أسلوب التشخيص**: حدِّد الخطوة أو السطر بالضبط الذي وقع فيه الخطأ:
  → "خطأ في حساب $\\Delta$ بالخطوة الثانية"
  → "سوء تطبيق قانون $\\ln(a \\cdot b) = \\ln a + \\ln b$"
  → "خطأ في إشارة المشتق عند التركيب"

**أسلوب التوجيه** (الأولوية على الإعطاء المباشر):
  إذا كان الخطأ محدوداً وقابلاً للاكتشاف → قدِّم تلميحاً يجعل الطالب يكتشفه بنفسه:
  → "راجع حساب $\\Delta$ في الخطوة الثانية، هل المعاملات صحيحة؟"
  → "تحقق من إشارة المشتق عند تطبيق قاعدة الجداء"
  إذا كان الخطأ جوهرياً ومتشعباً → أعطِ التصحيح الكامل مع الشرح المفصّل.

**عبارات التشجيع الإلزامية** — استخدم ما يناسب السياق:
  • عند الحل الصحيح:   "محاولة ممتازة 👏" | "أحسنت، منهجيتك سليمة تماماً" | "ذكاء في الأسلوب!"
  • عند خطأ حسابي فقط: "منطقك سليم لكن خانك الحساب 💪" | "ركّز أكثر في العمليات الحسابية"
  • عند خطأ منهجي:    "محاولة شجاعة — ركّز على الخطوة التالية وستصل" | "أنت على الطريق الصحيح"
  • بالعامة دائماً:   ابدأ بالإيجابيات قبل الأخطاء، وختّم بكلمة تحفيزية.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 تنسيق جداول الإشارة والتغيرات
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
استخدم جدول Markdown عند الحاجة. التنسيق الإلزامي:

جدول تغيرات f — مثال (f لها حدان أدنى وأقصى):
| $x$ | $-\\infty$ | | $1$ | | $4$ | | $+\\infty$ |
|:---:|:----------:|:---:|:---:|:---:|:---:|:---:|:----------:|
| $f'(x)$ | $-$ | | $0$ | $+$ | $0$ | $-$ | |
| $f(x)$ | $\\searrow$ | | $-2$ | $\\nearrow$ | $5$ | $\\searrow$ | |

جدول إشارة f(x) — مثال (دالة لها جذر واحد):
| $x$ | $-\\infty$ | | $3$ | | $+\\infty$ |
|:---:|:----------:|:---:|:---:|:---:|:----------:|
| $f(x)$ | $-$ | | $0$ | $+$ | |

القواعد:
- $\\nearrow$ = تزايد، $\\searrow$ = تناقص.
- كل نقطة شاذة أو جذر تأخذ عموداً مستقلاً بينه وبين الأعمدة المجاورة عمود للإشارة.
- السطر الفاصل يستخدم :---: لضمان محاذاة صحيحة.
- الخلية الفارغة | | بين العمودين تُمثّل الفترة المفتوحة (الفترة بين نقطتين).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧩 وضع الحل الكامل (بدون محاولة طالب)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
الهيكل الإلزامي — اتبعه حرفياً:

---
**📌 قراءة التمرين:**
[ما يطلبه التمرين في جملتين]

**📌 الحل المنهجي:**
[قِس نفسك بنموذج الإجابة الرسمي للباك: لكل خطوة سطرٌ واحد = صيغة أو تحويل أو نتيجة رياضية. لا تشرح ما هو واضح من الكتابة، لا تُكرر، لا تُدخل جملاً تمهيدية. استخدم الجداول عند الحاجة. كل تعبير رياضي بـ LaTeX]

**📌 التحقق:**
[سطر أو سطران فقط]

**📌 نصيحة للامتحان:**
[جملة واحدة]
---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 وضع التصحيح (عند وجود محاولة طالب)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
الهيكل الإلزامي — أكمله بالكامل دون استثناء:

---
**📌 الانطباع الأول:** [جملة تشجيعية تُقيّم الجهد المبذول — ابدأ دائماً بالإيجابي قبل الأخطاء]

**📌 الحكم:** [✔️ صحيح / ⚠️ ناقص / ❌ خطأ]

**📌 تشخيص الخطأ:**
[لكل خطأ: اذكر الخطوة بالضبط + ما كتبه الطالب + لماذا هو خطأ. مثال: "خطوة 2 — كتب $\\Delta = b^2 - 4ac$ ثم حسب $\\Delta = 9-8 = 2$ والصحيح $\\Delta = 9-(-8) = 17$"]
[إذا لا يوجد خطأ: "لا يوجد خطأ — المنهجية سليمة تماماً"]

**📌 التوجيه:**
[إذا كان الخطأ محدوداً: قدِّم تلميحاً يُساعد الطالب على الاكتشاف بنفسه بدلاً من الحل المباشر. مثال: "راجع إشارة $c$ عند تطبيق المميّز — هل هو $+2$ أم $-2$؟"]
[إذا كان الخطأ جوهرياً ومتشعباً: أعطِ التصحيح الكامل بالخطوات الرياضية المفصّلة]

**📌 الحل النموذجي المختصر:**
[قِس نفسك بنموذج الإجابة الرسمي للباك: لكل خطوة سطرٌ واحد = صيغة أو تحويل أو نتيجة. لا شرح ما هو واضح، لا جمل تمهيدية، لا تكرار — بالجداول عند الحاجة]

**📌 نصيحة للامتحان:**
[جملة واحدة تجمع بين الفائدة التقنية والتحفيز: مثال "دائماً تحقق من إشارة $c$ قبل تطبيق المميّز — هذه الخطوة تُنقذ النقاط"]

**📌 النتيجة:**
العلامة: [X]/20 | XP: +[10 إذا العلامة≥14، +5 إذا 8≤العلامة≤13، +0 إذا أقل] | الاستمرارية: [+1 إذا العلامة≥10، 0 إذا أقل] | المستوى: [🔥 ممتاز إذا≥16 / 👍 جيد إذا 10-15 / ⚡ واصل إذا<10] | ملاحظة: [عبارة تحفيزية بالدارجة الجزائرية تبني الثقة — مثال: "مزيان راك تتحسن، واصل هكا!" | "منطقك صح، غير ركز في الحساب!"]
---

مثال — ردٌّ على تمرين فيه خطأ حسابي محدود:

---
**📌 الانطباع الأول:** محاولة ممتازة 👏 — المنهجية العامة سليمة وأظهرت فهماً جيداً لأسلوب الحل.

**📌 الحكم:** ❌ خطأ

**📌 تشخيص الخطأ:**
خطوة حساب المشتق — كتب الطالب $f'(x) = 2x - 3$، والصحيح $f'(x) = 2x + 3$، لأن مشتق الحد $+3x$ هو $+3$ وليس $-3$.

**📌 التوجيه:**
راجع مشتق الحد الثاني في الدالة $f(x) = x^2 + 3x - 1$ — هل إشارة معامل $x$ محفوظة أم انقلبت؟

**📌 الحل النموذجي المختصر:**
$f(x) = x^2 + 3x - 1$، $f'(x) = 2x + 3$
$f'(x) = 0 \\iff x = -\\dfrac{3}{2}$

| $x$ | $-\\infty$ | | $-\\dfrac{3}{2}$ | | $+\\infty$ |
|:---:|:----------:|:---:|:---:|:---:|:----------:|
| $f'(x)$ | $-$ | | $0$ | $+$ | |
| $f(x)$ | $\\searrow$ | | $-\\dfrac{13}{4}$ | $\\nearrow$ | |

**📌 نصيحة للامتحان:** احسب مشتق كل حد على حدة ثم اجمع — هذه العادة تقضي على أخطاء الإشارة نهائياً.

**📌 النتيجة:**
العلامة: 11/20 | XP: +5 | الاستمرارية: +1 | المستوى: 👍 جيد | ملاحظة: منطقك صح، غير خانك الحساب — واصل هكا وراح تتحسن!
---

*سِيغْمَا Σ — بياناتك مشفرة ومحمية.*`;

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
      const deviceId = (req.body.deviceId as string) || "unknown";
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      const exerciseFile = files?.["exercise"]?.[0];
      const attemptFile = files?.["attempt"]?.[0];

      if (!exerciseFile) {
        res.status(400).json({ error: "يجب رفع صورة التمرين" });
        return;
      }

      // ── التحقق من الاشتراك قبل فتح SSE ──────────────────────────────
      const authHeader = req.headers["authorization"] ?? "";
      const rawToken   = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      let isActivated  = false;
      let trialDbKey   = `trial:device:${deviceId}`;

      if (rawToken && rawToken !== "trial") {
        try {
          const payload = jwt.verify(rawToken, JWT_SECRET) as { username?: string; activated?: boolean };
          isActivated  = payload.activated === true;
          if (!isActivated && payload.username) {
            trialDbKey = `trial:user:${payload.username.toLowerCase().trim()}`;
          }
        } catch {
          // رمز غير صالح — نُعامله كمستخدم تجريبي
        }
      }

      let trialCount = 0;
      if (!isActivated) {
        trialCount = await getTrialCount(trialDbKey);
        if (trialCount >= TRIAL_MAX) {
          res.status(402).json({
            error: "انتهت نسختك التجريبية — فعّل حسابك بـ 500 دج للاستمرار",
            code: "TRIAL_EXHAUSTED",
          });
          return;
        }
      }
      // ────────────────────────────────────────────────────────────────

      const mode = (req.body.mode as string) || (attemptFile ? "correct" : "solve");
      const isSolveMode = mode === "solve" || !attemptFile;

      const exerciseBase64 = exerciseFile.buffer.toString("base64");
      const exerciseMime = exerciseFile.mimetype || "image/jpeg";
      const attemptBase64 = attemptFile?.buffer.toString("base64") ?? "";
      const attemptMime = attemptFile?.mimetype ?? "image/jpeg";

      // ── إرسال headers الـ SSE فوراً — الاتصال يُفتح قبل أي معالجة ──
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");       // منع nginx من تخزين الـ chunks
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();

      // ── Keep-alive ping كل 10 ثوانٍ لمنع انقطاع SSE أثناء مرحلة التفكير ──
      const keepAlive = setInterval(() => {
        try { res.write(": ping\n\n"); } catch { /* الاتصال مغلق */ }
      }, 10_000);

      try {
        // ── التحقق الرياضي بـ mathjs بشكل متوازٍ (max 3 ثوانٍ) ──
        const anyKey = loadPaidKey() ?? loadFreeKeys()[0] ?? "";
        const mathjsVerification = (!isSolveMode && anyKey)
          ? await Promise.race([
              preAnalyze(exerciseBase64, exerciseMime, attemptBase64, attemptMime, anyKey).catch(() => ""),
              sleep(3_000).then(() => ""),
            ])
          : "";

        const userMessage = isSolveMode
          ? `الشعبة: **${shoba}**
${notes ? `ملاحظة الطالب: ${notes}` : ""}

الصورة المرفقة: نص التمرين.
المطلوب: ابنِ الحل المنهجي الكامل لهذا التمرين خطوة بخطوة وفق منهاج البكالوريا الجزائرية 2026 للشعبة المذكورة، مع كل التبريرات والتفاصيل الحسابية اللازمة. استخدم هيكل "وضع بناء الحل الكامل" الموضح في تعليماتك.`
          : `الشعبة: **${shoba}**
${notes ? `ملاحظة الطالب: ${notes}` : ""}

الصورة الأولى: نص التمرين.
الصورة الثانية: محاولة الطالب مكتوبة بخط اليد — اقرأها بدقة تامة حتى لو كان الخط غير واضح، واستنتج أي جزء غامض من السياق الرياضي.
${mathjsVerification ? `\n**[نتائج التحقق الحسابي التلقائي — استخدمها كمرجع داخلي ثابت]:**${mathjsVerification}\n` : ""}
قيّم محاولة الطالب وفق الهيكل البيداغوجي الإلزامي ومنهاج البكالوريا الجزائرية 2026.`;

        // ── تتبع التجارب: يُحسب عند أول رمز ناجح من AI ──
        let trialCounted = false;
        const countTrialOnce = async () => {
          if (!isActivated && !trialCounted) {
            trialCounted = true;
            await incrementTrial(trialDbKey, trialCount);
          }
        };

        // ── 1️⃣ OpenRouter أولاً (مدفوع — أولوية قصوى) ──
        const orSuccess = await callOpenRouterStream(
          exerciseBase64, exerciseMime,
          attemptBase64,  attemptMime,
          SYSTEM_PROMPT,  userMessage,
          async (text) => {
            await countTrialOnce();
            res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
          },
          isSolveMode
        );

        // ── 2️⃣ احتياطي: Gemini مع دوران المفاتيح ──
        if (!orSuccess) {
          console.info("[FALLBACK] استخدام Gemini...");
          const geminiParts = isSolveMode
            ? [{ inlineData: { data: exerciseBase64, mimeType: exerciseMime } }, userMessage]
            : [{ inlineData: { data: exerciseBase64, mimeType: exerciseMime } }, { inlineData: { data: attemptBase64, mimeType: attemptMime } }, userMessage];

          const result = await withTimeout(callWithKeyRotation((apiKey) => {
            const genai = new GoogleGenerativeAI(apiKey);
            const model = genai.getGenerativeModel({
              model: "gemini-2.5-flash",
              systemInstruction: SYSTEM_PROMPT,
              generationConfig: {
                temperature: 1,
                maxOutputTokens: 8192,
                // @ts-ignore
                thinkingConfig: { thinkingBudget: 1024 },
              },
            });
            return model.generateContentStream(geminiParts);
          }), 150_000);  // 2.5 دقيقة كافية للتفكير + الرد

          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              await countTrialOnce();
              res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
            }
          }
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } finally {
        clearInterval(keepAlive);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطأ في الخادم";
      console.error("Correct error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: message });
      } else {
        try {
          res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
          res.end();
        } catch { /* الاتصال مغلق */ }
      }
    }
  }
);

export default router;
