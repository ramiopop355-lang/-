import { Router, type IRouter } from "express";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { evaluate } from "mathjs";
import OpenAI from "openai";

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
  onChunk: (text: string) => void,
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
      if (text) onChunk(text);
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

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 قراءة الصور
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• اقرأ صورة التمرين وصورة إجابة الطالب بعناية تامة.
• الخط اليدوي: استنتج الأجزاء الغامضة من السياق الرياضي.
• لا تقل أبداً "الصورة غير واضحة" — قدّم دائماً قراءتك الأفضل وأكمل التصحيح.
• إذا لم يكن التمرين له علاقة بالرياضيات، أخبر الطالب بجملة واحدة وأوقف.

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

• **المتتاليات**: الحسابية والهندسية، suites récurrentes، البرهان بالاستقراء الرياضي.

• **الهندسة**: المتجهات، المستقيمات والمستويات، المعادلات الديكارتية والبارامترية، المسافات والزوايا.

🚫 **طرق جامعية ممنوعة تماماً** — لا تذكرها ولا تستخدمها:
قاعدة لوبيتال • متسلسلة تايلور/ماكلورين • التعريف $\\varepsilon$-$\\delta$ • التكاملات المتعددة • المعادلات التفاضلية المتقدمة • القيم الذاتية.

⚠️ إذا استخدم الطالب طريقة جامعية: صحّح النتيجة الرياضية كما هي، ونبّه في "📌 نصيحة" أن الطريقة غير مقررة في البكالوريا.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ قواعد الحكم
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✔️ **صحيح** — النتيجة والخطوات الجوهرية صحيحة رياضياً (قبل أي تعبير مكافئ).
⚠️ **ناقص** — صحيح لكن تنقصه خطوات أو تبريرات مطلوبة في الباك.
❌ **خطأ** — يوجد خطأ رياضي حقيقي يُغيّر النتيجة أو يفسد الطريقة.

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
[الحل الكامل خطوة بخطوة — سمِّ كل خطوة، بيّن كل التفاصيل الحسابية، استخدم الجداول عند الحاجة، كل تعبير رياضي بـ LaTeX]

**📌 التحقق:**
[تحقق بالتعويض أو بطريقة مناسبة]

**📌 نصيحة للامتحان:**
[نقطة واحدة مهمة حول هذا النوع من المسائل]
---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 وضع التصحيح (عند وجود محاولة طالب)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
الهيكل الإلزامي — أكمله بالكامل دون استثناء:

---
**📌 الحكم:** [✔️ صحيح / ⚠️ ناقص / ❌ خطأ]

**📌 أين أخطأ الطالب:**
[اذكر كل خطأ بدقة: الخطوة، ما كتبه الطالب، لماذا هو خطأ — أو: لا يوجد خطأ]

**📌 التصحيح:**
[صحّح كل خطأ بالخطوات الرياضية الكاملة مع LaTeX. إذا احتاج جدولاً استخدم تنسيق Markdown.]

**📌 الحل النموذجي المختصر:**
[الحل الصحيح الكامل كما يُكتب في الباك — منظم، مفصّل، بالجداول عند الحاجة]

**📌 نصيحة:**
[جملة واحدة مفيدة في الامتحان]
---

مثال — ردٌّ على تمرين فيه خطأ:

---
**📌 الحكم:** ❌ خطأ

**📌 أين أخطأ الطالب:**
في حساب المشتق: كتب $f'(x) = 2x - 3$ لكن الصحيح $f'(x) = 2x + 3$ لأن $(-3)' = 0$ وليس $-3$.

**📌 التصحيح:**
$f(x) = x^2 + 3x - 1$
$f'(x) = 2x + 3$ (مشتق الحد الأول $2x$، مشتق الحد الثاني $+3$، مشتق الثابت $0$)
التحقق: $f(0) = -1$ وهو ليس حداً أدنى لأن $f'(0) = 3 \\neq 0$.

**📌 الحل النموذجي المختصر:**
$f(x) = x^2 + 3x - 1$، $f'(x) = 2x + 3$
$f'(x) = 0 \\iff x = -\\dfrac{3}{2}$

| $x$ | $-\\infty$ | | $-\\dfrac{3}{2}$ | | $+\\infty$ |
|:---:|:----------:|:---:|:---:|:---:|:----------:|
| $f'(x)$ | $-$ | | $0$ | $+$ | |
| $f(x)$ | $\\searrow$ | | $-\\dfrac{13}{4}$ | $\\nearrow$ | |

**📌 نصيحة:** احسب مشتق كل حد بشكل منفصل قبل جمعها لتجنب أخطاء الإشارة.
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
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;

      const exerciseFile = files?.["exercise"]?.[0];
      const attemptFile = files?.["attempt"]?.[0];

      if (!exerciseFile) {
        res.status(400).json({ error: "يجب رفع صورة التمرين" });
        return;
      }

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

        // ── 1️⃣ OpenRouter أولاً (مدفوع — أولوية قصوى) ──
        const orSuccess = await callOpenRouterStream(
          exerciseBase64, exerciseMime,
          attemptBase64,  attemptMime,
          SYSTEM_PROMPT,  userMessage,
          (text) => res.write(`data: ${JSON.stringify({ content: text })}\n\n`),
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
                thinkingConfig: { thinkingBudget: 2048 },
              },
            });
            return model.generateContentStream(geminiParts);
          }), 150_000);  // 2.5 دقيقة كافية للتفكير + الرد

          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
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
