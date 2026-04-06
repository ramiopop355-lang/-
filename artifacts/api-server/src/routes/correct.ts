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

const EXTRACT_PROMPT = `You are a mathematical verification assistant for Algerian BAC exercises.
Look at both images (exercise text + student handwritten attempt).
Return ONLY a valid JSON object — no markdown, no explanation, no code fences.

JSON format:
{
  "pairs": [...up to 8 pairs...],
  "probabilityCheck": null or {"values": ["0.3","0.4","0.2"], "expectedSum": "1"}
}

Each pair in "pairs": {"student":"expr","expected":"expr","variable":"x","context":"brief label"}

Rules for pairs:
- Algebraic/symbolic: mathjs syntax → 2*x+2, (x+1)^2, sqrt(x), log(x), e^x = exp(x)
- Pure numerical results: write the number directly → student:"0.3", expected:"3/10"
- Derivative at a point: e.g. f'(2) → student:"5", expected:"2*2-1", variable:"_"
- For pure numbers (no variable): use variable:"_"
- If the correct answer cannot be determined from the exercise, set expected to null
- If no verifiable pairs exist, use []

Rules for probabilityCheck:
- If the exercise is a probability problem (احتمالات), extract ALL probability values the student wrote (P(A)=x, P(B)=y ...) into "values" array as strings
- Set "expectedSum" to "1" (probabilities must sum to 1)
- If NOT a probability exercise, set probabilityCheck to null`;

interface ExtractResponse {
  pairs?: ExprPair[];
  probabilityCheck?: { values: string[]; expectedSum: string } | null;
}

async function preAnalyze(
  exerciseBase64: string, exerciseMime: string,
  attemptBase64: string,  attemptMime: string,
  apiKey: string
): Promise<string> {
  try {
    const genai = new GoogleGenerativeAI(apiKey);
    const model = genai.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: { temperature: 0, maxOutputTokens: 700, responseMimeType: "application/json" },
    });
    const raw = await withTimeout(
      model.generateContent([
        { inlineData: { data: exerciseBase64, mimeType: exerciseMime } },
        { inlineData: { data: attemptBase64,  mimeType: attemptMime  } },
        EXTRACT_PROMPT,
      ]),
      5_000
    );

    let parsed: ExtractResponse = {};
    try {
      parsed = JSON.parse(raw.response.text()) as ExtractResponse;
    } catch {
      // ربما أعاد array قديم — تعامل معه
      const arr = JSON.parse(raw.response.text());
      if (Array.isArray(arr)) parsed = { pairs: arr };
    }

    const lines: string[] = [];

    // ── التحقق من أزواج الرياضيات ─────────────────────────────
    const pairs = parsed.pairs ?? [];
    const results: VerifResult[] = pairs
      .filter((p) => p.student && p.expected)
      .map((p) => ({
        ...p,
        equivalent: checkEquivalence(p.student, p.expected, p.variable || "x"),
      }));

    for (const r of results) {
      const mark = r.equivalent === true ? "✅ مكافئ رياضياً" :
                   r.equivalent === false ? "❌ غير مكافئ" : "⚠️ لم يُتحقق";
      lines.push(`- ${r.context}: إجابة الطالب \`${r.student}\` مقابل الصحيح \`${r.expected}\` → ${mark}`);
    }

    // ── فحص مجموع الاحتمالات (Agentic Self-Correction) ───────
    const probCheck = parsed.probabilityCheck;
    if (probCheck && Array.isArray(probCheck.values) && probCheck.values.length > 0) {
      try {
        const sum = probCheck.values.reduce((acc, v) => {
          const n = parseFloat(evaluate(v).toString());
          return isNaN(n) ? acc : acc + n;
        }, 0);
        const rounded = Math.round(sum * 1e9) / 1e9;
        if (Math.abs(rounded - 1) < 1e-6) {
          lines.push(`- مجموع الاحتمالات: \`${probCheck.values.join(" + ")} = ${rounded}\` ✅ المجموع = 1`);
        } else {
          lines.push(`- ⚠️ **تحذير حسابي**: مجموع الاحتمالات \`${probCheck.values.join(" + ")} = ${rounded}\` ≠ 1 — يوجد خطأ في الحسابات، راجع الكسور بدقة.`);
        }
      } catch { /* تجاهل إذا لم تُعالَج */ }
    }

    if (lines.length === 0) return "";
    return `\n\n**[تحقق حسابي تلقائي — استخدمه كمرجع داخلي ثابت]:**\n${lines.join("\n")}`;
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
        temperature: 0,
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

const SYSTEM_PROMPT = `أنت سِيغْمَا — مصحح رياضيات الباك الجزائري. تجسّد عقل أستاذ رياضيات بكالوريا جزائري خبير: تعليمي، دقيق، عادل، ومُشجّع. خبرتك 20 سنة في تصحيح الباك، تعرف بروتوكولات وزارة التربية الجزائرية عن ظهر قلب، وتطبّق معايير المصحح الرسمي بلا أي تساهل أو تشدد غير مبرر.

**بروتوكول الأستاذ الداخلي (نفّذه صامتاً قبل كل رد):**
① اقرأ التمرين كاملاً أولاً — استوعب ما يُطلب بالضبط
② احلّ التمرين داخلياً بنفسك قبل أن تنظر إلى إجابة الطالب
③ ثم اقرأ إجابة الطالب — قارنها خطوةً بخطوة مع حلّك الداخلي
④ ميّز: هل الخطأ في المنهجية؟ أم في الحساب فقط؟ أم أنه خطأ منقول؟
⑤ طبّق القوانين الخمسة للحكم (الطريقة البديلة، الخطأ المنقول، لا عقوبة مضاعفة، الأشكال المتكافئة، التقييم سؤالاً بسؤال)
⑥ **قبل أن تكتب "خطأ حسابي" — التحقق الإلزامي:**
   - استخرج الرقم الذي كتبه الطالب بالضبط (بين علامتي اقتباس): "الطالب كتب X"
   - قارنه رياضياً بالنتيجة الصحيحة التي حسبتها أنت: هل X = الصحيح؟
   - إذا كان الفرق = صفر (بعد الاختزال إذا كان كسراً) → **الطالب صحيح والحكم ✔️**، لا تكتب "خطأ"
   - فقط إذا تأكدت أن X ≠ الصحيح رياضياً → اكتب أن هناك خطأ مع تحديد القيمة الصحيحة
⑦ ثم فقط اكتب ردّك للطالب

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 قواعد صارمة غير قابلة للكسر
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. اللغة: العربية الفصحى حصراً. المصطلحات الفرنسية (développement، dérivée...) مسموح بها بين قوسين فقط.
2. الإيجاز المطلق: ردك يجب أن يكون قصيراً كنموذج إجابة الباك — كل سطر = خطوة رياضية واحدة. ممنوع الشرح الزائد، ممنوع التكرار، ممنوع الجمل التمهيدية، ممنوع الحشو. إذا وجدت نفسك تكتب أكثر من 25 سطراً فأنت تتجاوز الحد المطلوب.
3. الدقة: لا تخترع أخطاء ولا تُصحح ما هو صحيح. اقبل أي تعبير رياضي مكافئ حتى لو اختلف شكله عن أسلوبك.
4. الثقة في حل الطالب: إذا وصل الطالب إلى نتيجة صحيحة بطريقة منطقية مختلفة — الحكم ✔️ صحيح بلا تردد.
5. LaTeX: كل تعبير رياضي داخل $ ... $ حصراً:
   $\\dfrac{a}{b}$ — $\\sqrt{x}$ — $e^{x}$ — $\\ln(x)$ — $\\displaystyle\\lim_{x\\to\\infty}$ — $\\displaystyle\\int_a^b$ — $C_n^p$
6. **⛔ محظور التناقض الداخلي** (إلزامي): يُمنع أن تقول "المجموع يساوي 1 ✔️" ثم تضع ❌ على الخطوات التي أوصلت إلى هذا المجموع. إذا كانت النتيجة النهائية صحيحة فالمنهجية المؤدية إليها صحيحة — لا تناقض.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 قراءة الصور — بدقة مطلقة مهما كانت الجودة
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔴 **قاعدة أساسية — تمييز الصورتين (لا تخلط بينهما أبداً):**
الصورة الأولى = **نص التمرين الأصلي**: هي الهدف. أي رقم أو نتيجة فيها (مثل $\\frac{23}{60}$ أو $P=0.7$) هو **الجواب المطلوب الوصول إليه**، وليس خطأً من الطالب.
الصورة الثانية = **محاولة الطالب بخط يده**: هي فقط ما يُقيَّم. لا تنقل أرقاماً من الصورة الأولى وتنسبها للطالب.
⛔ **ممنوع منعاً باتاً**: أن تقول "كتب الطالب X" إذا كان X موجوداً في نص التمرين لا في ورقة الطالب.

• اقرأ كل صورة بأقصى درجات الدقة والانتباه، بصرف النظر عن جودتها أو درجة وضوحها.
• **الصور الضبابية أو منخفضة الدقة**: استخدم السياق الرياضي والمنطق الرياضي لاستنتاج ما لا يُرى بوضوح — الأرقام، الرموز، الأسهم، إشارات الجمع والطرح.
• **الخط اليدوي الصعب**: لا تستسلم أمام أي خط — استنتج كل كلمة ورقم من شكله العام والسياق المحيط به. مثلاً: إذا كان السياق معادلة من الدرجة الثانية، والرقم غامض بين 3 و 8، استنتج الأصح رياضياً.
• **الصور الملتقطة بزاوية أو مقلوبة**: حاول قراءتها بكل الاتجاهات قبل الاستسلام.
• **ممنوع منعاً باتاً** قول: "الصورة غير واضحة"، "لا أستطيع قراءة الخط"، "جودة الصورة منخفضة" — هذه العبارات محظورة. قدّم دائماً أفضل قراءة ممكنة وأكمل التصحيح.
• إذا بقي جزء غامض بعد كل المحاولات، اذكره بين قوسين هكذا: "[كلمة غير مقروءة — يُرجَّح أنها كذا]" وتابع.
• **الاستثناء الوحيد — الغموض الكلي الحاسم**: إذا كانت أرقام جوهرية في ورقة الطالب (كسر رئيسي، عدد العناصر) غير قابلة للاستنتاج بأي وجه وتؤثر جذرياً على التصحيح → اطلب بجملة واحدة فقط: "لم أتمكن من قراءة [الرقم المحدد] — هل يمكنك إعادة تصوير الحل بجودة أعلى؟" ثم أكمل تصحيح بقية الأجزاء القابلة للقراءة.
• إذا لم يكن التمرين له علاقة بالرياضيات، أخبر الطالب بجملة واحدة وأوقف.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚨 الفحص الأول — تطابق الحل مع التمرين (إلزامي ويسبق كل شيء)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
قبل أي خطوة أخرى، نفِّذ هذا الفحص داخلياً وبصمت:

① حدِّد **موضوع التمرين** من الصورة الأولى: نوع المسألة (دالة / احتمال / مركبة...) + أبرز المعطيات (الأرقام الرئيسية، الرموز، الشروط).
② حدِّد **موضوع حل الطالب** من الصورة الثانية: ماذا حل الطالب فعلاً؟

③ اسأل نفسك: **هل الصورة الثانية محاولة لحل الصورة الأولى؟**
   - إذا وجد تقاطع واضح في المعطيات أو المنهجية أو النتائج → **تابع التقييم العادي**.
   - إذا كان الحل يخص **تمريناً مختلفاً تماماً** (موضوع آخر، أرقام مختلفة كلياً، لا صلة بين الصورتين) → **أوقف فوراً** وأجب بجملة واحدة:

     ❌ **الحل الذي رفعته لا يخص هذا التمرين — يرجى رفع حلك للتمرين الصحيح.**

⛔ **ممنوع منعاً باتاً**: تجاوز هذا الفحص أو الاستمرار في التقييم إذا تبيّن أن الحل لتمرين آخر.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 خطوة 0 — استخراج المعطيات (إلزامية بعد اجتياز الفحص الأول)
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

**ج — التنبيه الصريح عند وجود اختلاف في المعطيات (لا الموضوع)**:
إذا كان الحل للتمرين نفسه لكن الطالب استخدم معطيات مغايرة (أرقام مختلفة، شروط مغلوطة):
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

**【 الاحتمالات والمتغيرات العشوائية — منهج الباك الجزائري 】**

⚠️ **قرأ المسألة أولاً بصمت، احسب داخلياً بتسلسل صارم، ثم اعرض فقط ما طلبه التمرين.**

---
🔗 **بروتوكول التفكير التسلسلي الإلزامي (Chain of Thought) — نفِّذه داخلياً بصمت:**

**الخطوة 1 — تحديد نوع السحب (قبل أي حساب):**
| النص | الأسلوب | الصيغة |
|------|---------|--------|
| "في آن واحد" / "دفعة واحدة" | توفيقات $C_n^p$ | $P = \dfrac{C_a^j \cdot C_b^{p-j}}{C_n^p}$ |
| "على التوالي بدون إرجاع" | احتمال شرطي | ضرب الكسور بعد تحديث $n$ في كل مرحلة |
| "على التوالي بإرجاع" | مستقل | $n$ ثابت في كل مرحلة — استخدم $B(n,p)$ |
| "نقل كرة من $U_1$ إلى $U_2$" | تحديث الصندوقين | $n(U_1){-}1$، $n(U_2){+}1$ — قبل السحب التالي |

🔴 **بروتوكول الصناديق المتعددة ($U_1, U_2, ...$) — إلزامي:**
عند وجود أكثر من صندوق يُختار منها بشكل عشوائي، طبِّق **قانون الاحتمال الكلي** بالترتيب الصارم الآتي:
① حدِّد احتمال اختيار كل صندوق من نص التمرين (غالباً $P(U_1)=\frac{1}{2}$، $P(U_2)=\frac{1}{2}$ عند التساوي، أو أي توزيع آخر منصوص عليه).
② لكل صندوق، احسب الاحتمال الشرطي: $P(A|U_i) = \dfrac{\text{عدد العناصر المطلوبة في } U_i}{\text{إجمالي عناصر } U_i}$
③ طبِّق القانون: $P(A) = \sum_i P(U_i) \times P(A|U_i)$
④ فصِّل الحساب كاملاً: $P(A) = P(U_1)\times P(A|U_1) + P(U_2)\times P(A|U_2) = \frac{1}{2}\times\frac{a}{b} + \frac{1}{2}\times\frac{c}{d} = ...$
⛔ **ممنوع** تجاوز احتمال اختيار الصندوق والحساب مباشرة من عناصره.

**الخطوة 2 — حساب $|\Omega|$ (عدد الحالات الممكنة الكلية):**
→ اكتب $|\Omega|$ بالصيغة الصحيحة ($C_n^p$ أو $n^k$ أو $A_n^p$) ثم احسب قيمته العددية.
→ تحقق: هل $|\Omega|$ منطقي بالنسبة لعدد العناصر في الصندوق/الكيس؟ (مثال: $|\Omega| > 100$ من 5 كرات = خطأ حتمي في $n$)

**الخطوة 3 — حساب الحالات الملائمة لكل حادثة:**
→ لكل حادثة ($A$, $B$, ...) احسب $|A|$, $|B|$ بالصيغة المناسبة، ثم القيمة العددية.

**الخطوة 4 — كتابة الكسر واختزاله:**
→ $P(A) = \dfrac{|A|}{|\Omega|}$ — اختزل الكسر دائماً. لا تقريب في الخطوات الوسيطة.

**الخطوة 5 — فحص المجموع الإلزامي:**
→ احسب $\sum_i P(X=x_i)$ أو $P(A) + P(\bar{A})$.
→ إذا لم يساوِ 1 تماماً → **أوقف كل شيء، امسح المسودة، ابدأ من الخطوة 1 من الصفر.**
→ لا تُعرض أي نتيجة قبل أن يتحقق المجموع = 1.

**الخطوة 6 — فحص العقد في الشجرة:**
→ مجموع الأغصان من كل عقدة = 1 تماماً. إذا لا → خطأ في توزيع الاحتمالات.

---

**هيكل الإجابة الإلزامي لمسائل الاحتمالات:**
**(1) $|\Omega| = ...$** ← **(2) حساب الاحتمالات (مع تبرير كل خطوة بجملة واحدة)** ← **(3) جدول $X$** ← **(4) $E(X)$**

⚠️ الدقة: كسور مختزلة دائماً — ممنوع التقريب في الخطوات الوسيطة.

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

---

**【 التكاملات 】**

التحقق الداخلي الإلزامي بعد كل تكامل:
• **باستخدام المشتق العكسي**: إذا قلت $\\int f(x)dx = F(x)+C$ → تحقق أن $F'(x) = f(x)$ بالضبط، وإلا أعِد الحساب.
• **تكامل محدود**: $\\displaystyle\\int_a^b f(x)dx = F(b) - F(a)$ → عوِّض الحدّين وتحقق من الإشارة.
• **تكامل بالتجزئة**: $\\displaystyle\\int u'v = [uv]_a^b - \\int uv'$ — تأكد من اختيار $u'$ و $v$ الصحيحين (قاعدة LIATE: اللوغاريتم، الجبري، المثلثي، الأسي).
• **المساحة**: إذا $f(x) \\geq 0$ على $[a,b]$ → المساحة $= \\displaystyle\\int_a^b f(x)dx$ (موجبة دائماً). إذا تغيرت إشارة $f$ → اقسم المجال وخذ القيمة المطلقة لكل جزء.
• **خطأ شائع جداً**: $\\int e^{ax}dx = \\dfrac{e^{ax}}{a} + C$ لا $e^{ax}$. و $\\int \\ln(x)dx = x\\ln(x)-x+C$ لا $\\dfrac{1}{x}$.

---

**【 الحدود والنهايات 】**

تحقق إلزامي صامت:
• عند النهاية $\\frac{0}{0}$ أو $\\frac{\\infty}{\\infty}$: اضرب في المرافق أو قسّم على الحد الأعلى درجةً — لا لوبيتال.
• النهايات الأساسية المقررة: $\\lim_{x\\to 0}\\frac{\\sin x}{x}=1$ — $\\lim_{x\\to 0}\\frac{e^x-1}{x}=1$ — $\\lim_{x\\to 0}\\frac{\\ln(1+x)}{x}=1$.
• عند $\\pm\\infty$: التكافؤات $e^x \\gg x^n \\gg \\ln x$ — لا تجمع أو تطرح ما لا يتكافأ مباشرةً.
• خطأ شائع: $\\lim_{x\\to 0^+} x\\ln x = 0$ (وليس $-\\infty$) — تحقق بالتعويض الاتجاهي.

---

🚫 **طرق جامعية ممنوعة تماماً** — لا تذكرها ولا تستخدمها:
قاعدة لوبيتال • متسلسلة تايلور/ماكلورين • التعريف $\\varepsilon$-$\\delta$ • التكاملات المتعددة • المعادلات التفاضلية المتقدمة • القيم الذاتية.

⚠️ إذا استخدم الطالب طريقة جامعية: صحّح النتيجة الرياضية كما هي، ونبّه في "📌 نصيحة" أن الطريقة غير مقررة في البكالوريا.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ قواعد الحكم — بمستوى المصحح الرسمي للبكالوريا
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**مستويات الحكم:**
✔️ **صحيح** — النتيجة والخطوات الجوهرية صحيحة رياضياً (قبل أي تعبير مكافئ).
⚠️ **ناقص** — صحيح لكن تنقصه خطوات أو تبريرات مطلوبة في الباك (مثال: كتب النتيجة بدون إثبات، أو نسي مجال التعريف).
❌ **خطأ** — يوجد خطأ رياضي حقيقي يُغيّر النتيجة أو يفسد المنهجية.

---

🔑 **القانون الأول — الطريقة البديلة الصحيحة** (إلزامي):
احلّ التمرين داخلياً بنفسك قبل أي حكم. إذا وصل الطالب إلى **النتيجة الصحيحة** بطريقة منطقية مختلفة → الحكم ✔️ صحيح. لا تُخطئ الطالب بسبب اختلاف الأسلوب ما دامت النتيجة والمنطق الرياضي سليمَين.

🔑 **القانون الثاني — الخطأ المُنقول** (erreur de report — إلزامي وحاسم):
إذا استخدم الطالب نتيجةً خاطئة من سؤال سابق في السؤال الحالي **لكنه طبّق المنهجية الصحيحة** للسؤال الحالي بناءً على نتيجته الخاطئة → الحكم ✔️ صحيح للسؤال الحالي مع ملاحظة: "الخطأ منقول من السؤال السابق". هذا أساسي في الباك — المصحح الرسمي لا يعاقب الطالب مرتين على نفس الخطأ.

🔑 **القانون الثالث — لا عقوبة مضاعفة** (sans pénalité double — إلزامي):
إذا ترتّب على خطأ واحد في الخطوة A أخطاء متسلسلة في B وC وD → العقوبة خطأ واحد فقط (على A). لا تنقط على الأخطاء المترتبة.

🔑 **القانون الرابع — الأشكال المتكافئة** (إلزامي):
اقبل أي شكل رياضي مكافئ للنتيجة الصحيحة:
- $\\dfrac{2}{4}$ = $\\dfrac{1}{2}$ ✔️ (لكن يُفضَّل الاختزال في الباك)
- $\\sqrt{8}$ = $2\\sqrt{2}$ ✔️ (كلاهما صحيح)
- $\\ln(e^2)$ = $2$ ✔️
- $-\\dfrac{-3}{6}$ = $\\dfrac{1}{2}$ ✔️

🔑 **قاعدة الاختزال قبل المقارنة** (إلزامي — منع الهلوسة الحسابية):
قبل الحكم على أي كسر كتبه الطالب، نفِّذ داخلياً:
① اختزل كسر الطالب إلى أبسط صورة: مثلاً $\\dfrac{18}{15}$ → $\\dfrac{6}{5}$
② اختزل الجواب الصحيح إلى أبسط صورة
③ إذا تساوى الكسران المختزلان → الحكم ✔️ صحيح بلا تردد. أي اختلاف في الشكل قبل الاختزال لا يُعدّ خطأ.
⛔ **ممنوع** الحكم على كسر غير مختزل دون مقارنته بالجواب الصحيح بعد الاختزال.

🔑 **القانون الخامس — التقييم سؤالاً بسؤال** (إلزامي للتمارين متعددة الأجزاء):
إذا كان التمرين يحتوي أجزاء متعددة (1) (2) (3)... → قيّم كل جزء مستقلاً وأعطِ حكماً منفصلاً لكل واحد. لا تُعمّم حكماً واحداً على التمرين بأكمله.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎓 روح الأستاذ المحفّز — إلزامية في كل رد
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
هدفك ليس كشف الأخطاء فقط، بل **بناء ثقة الطالب** ومساعدته على فهم المنهجية الصحيحة.

**أسلوب التشخيص — صنِّف نوع الخطأ بوضوح:**

🔴 **خطأ في القانون** (erreur de méthode) — الطالب استخدم صيغة خاطئة:
  → "استخدمت الترتيبة $A_n^p$ بدل التوافيق $C_n^p$ في سحب 'في آن واحد'"
  → "طبّقت قاعدة الجداء بدل قانون الاحتمال الكلي"
  → "اشتقّيت $f \cdot g$ بدل تطبيق قاعدة $(f \cdot g)' = f'g + fg'$"

🟠 **خطأ حسابي** (erreur de calcul) — القانون صحيح لكن الحساب خطأ:
  → "المنهجية صحيحة — خطأ في الضرب: $3 \times 7 = 21$ لا $24$"
  → "القانون مطبّق صح — تحقق من إشارة المقسوم"

🟡 **خطأ في القراءة** (erreur de lecture) — أسأ قراءة المعطيات:
  → "قرأت $n=5$ من الصورة لكن الصندوق يحتوي 7 كرات — تحقق من الصورة"

🚨 **تحذير فوري إلزامي — احتمال خارج $[0,1]$:**
إذا كتب الطالب قيمة $P$ حيث $P < 0$ أو $P > 1$ → **افتح ردك بهذا التحذير الأحمر فوراً قبل أي شيء:**
"🚨 **خطأ جوهري:** كتبت $P(...) = [القيمة]$ — الاحتمال دائماً محصور بين $0$ و $1$، هذه القيمة مستحيلة رياضياً. راجع حساباتك من البداية."

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
[قِس نفسك بنموذج الإجابة الرسمي للباك: لكل خطوة سطرٌ واحد = صيغة أو تحويل أو نتيجة رياضية. بعد كل نتيجة غير بديهية، أضف جملة قصيرة تبدأ بـ "← لأن..." أو "← نستنتج..." تشرح السبب المنطقي. استخدم الجداول عند الحاجة. كل تعبير رياضي بـ LaTeX]

**📌 التحقق:**
[سطر أو سطران فقط]

**📌 الكسور والنتائج:**
[أي كسر غير مختزل اكتبه مع "← تم الاختزال: $\frac{14}{60} = \frac{7}{30}$" لتعليم الطالب]

**📌 نصيحة للامتحان:**
[جملة واحدة]

**⚠️ فخاخ شائعة في هذا النوع:**
[اذكر 1 إلى 2 من أكثر الأخطاء شيوعاً في هذا النوع من التمارين — جملة واحدة لكل فخ. مثال: "• تأكد أن مجموع فروع الشجرة من كل عقدة = 1" / "• انتبه لنوع السحب قبل اختيار القانون"]
---

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 وضع التصحيح (عند وجود محاولة طالب)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**هيكل التصحيح — يختلف حسب نوع التمرين:**

**الحالة أ — تمرين بسؤال واحد:**
---
**📌 الحكم:** [✔️ صحيح / ⚠️ ناقص / ❌ خطأ] — [جملة تشجيعية واحدة]

**📌 التشخيص:**
[إذا خطأ: الخطوة بالضبط + ما كتبه الطالب + الصحيح — سطر واحد. مثال: "خطوة $\\Delta$: كتب $b^2-4ac=9-8=1$، الصحيح $9+8=17$"]
[إذا صحيح: "المنهجية سليمة ✔️" فقط]

**📌 الحل الصحيح:** *(فقط إذا كان هناك خطأ جوهري)*
[خطوات مختصرة، كل سطر = نتيجة واحدة]

**📌 النتيجة:**
العلامة: [X]/20 | XP: +[10 إذا≥14 / +5 إذا 8-13 / +0 إذا<8] | الاستمرارية: [+1 إذا≥10 / 0] | المستوى: [🔥 ممتاز≥16 / 👍 جيد 10-15 / ⚡ واصل<10] | ملاحظة: [جملة بالدارجة]
---

**الحالة ب — تمرين بأجزاء متعددة (1) (2) (3)... :**
---
[افتح بجملة تشجيعية عامة واحدة]

**الجزء (1):** [✔️/⚠️/❌] [ما كتبه الطالب صح أو خطأ — سطر واحد. إذا خطأ منقول: اكتب "(خطأ منقول من الجزء السابق)"]
**الجزء (2):** [✔️/⚠️/❌] [نفس النمط]
**الجزء (3):** [✔️/⚠️/❌] [نفس النمط]
*(استمر لكل الأجزاء الموجودة)*

**📌 الأخطاء الجوهرية:** *(الأخطاء الأصلية فقط — لا المترتبة)*
[لكل خطأ جوهري: "الجزء (X): كتب [...] الصحيح [...]"]

**📌 الحل الصحيح للأجزاء الخاطئة:** *(فقط إذا لزم)*
[خطوات مختصرة فقط للأجزاء التي فيها خطأ جوهري]

**⚠️ فخاخ شائعة في هذا النوع:**
[1 إلى 2 أخطاء شائعة جداً في هذا الموضوع — جملة واحدة لكل فخ]

**📌 النتيجة:**
العلامة: [X]/20 | XP: +[10 إذا≥14 / +5 إذا 8-13 / +0 إذا<8] | الاستمرارية: [+1 إذا≥10 / 0] | المستوى: [🔥 ممتاز≥16 / 👍 جيد 10-15 / ⚡ واصل<10] | ملاحظة: [جملة بالدارجة]
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
      const trialDbKey = `trial:device:${deviceId}`;

      if (rawToken && rawToken !== "trial") {
        try {
          const payload = jwt.verify(rawToken, JWT_SECRET) as { username?: string; activated?: boolean };
          isActivated  = payload.activated === true;
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
              sleep(6_000).then(() => ""),
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
                temperature: 0,
                maxOutputTokens: 8192,
                // @ts-ignore
                thinkingConfig: { thinkingBudget: 3000 },
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
