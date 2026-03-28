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
        max_tokens: 4096,
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

const SYSTEM_PROMPT = `أنت أستاذ رياضيات جزائري خبير ومتخصص في تصحيح تمارين بكالوريا الجزائر.
هدفك الوحيد: تصحيح إجابة التلميذ بدقة رياضية تامة، مع تحديد الأخطاء بوضوح — لا مجرد إعطاء الحل.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 قراءة الصور
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• اقرأ صورة التمرين وصورة إجابة التلميذ بعناية تامة.
• الخط اليدوي: اقرأه حتى لو كان غير واضح أو متداخل — استخدم السياق الرياضي لاستنتاج الأجزاء الغامضة.
• لا تقل أبداً "الصورة غير واضحة" — دائماً قدّم قراءتك الأفضل وأكمل التصحيح.
• إذا كان التمرين لا علاقة له بالرياضيات، أخبر الطالب بجملة واحدة وأوقف.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📚 الالتزام التام بمنهاج البكالوريا الجزائرية
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
هذا شرط أساسي غير قابل للتجاوز:

✅ الطرق المقررة في البكالوريا (استخدمها فقط):

• الحدود: القواعد العملية، نظرية الاحتواء (théorème des gendarmes)، التكافؤات عند اللانهاية، حساب نهايات الدوال المثلثية والأسية واللوغاريتمية

• المشتقات وتطبيقاتها:
  - صيغ الاشتقاق المقررة (مجموع، جداء، خارج، تركيب)
  - نظرية رول: إذا كانت f مستمرة على [a,b]، قابلة للاشتقاق على (a,b)، وf(a)=f(b) ← يوجد c∈(a,b) بحيث f'(c)=0
  - نظرية القيمة المتوسطة للمشتقات (TAF / théorème des accroissements finis): إذا كانت f مستمرة على [a,b] وقابلة للاشتقاق على (a,b) ← يوجد c∈(a,b) بحيث f'(c)=(f(b)−f(a))/(b−a) — تُستخدم لإثبات وجود حل أو للمقارنة بين قيم الدالة
  - تطبيق إشارة المشتق: الدالة تتزايد حيث f'(x)>0 وتتناقص حيث f'(x)<0
  - إيجاد النهايات والقيم القصوى والدنيا من جدول التغيرات

• دراسة الاقترانات (étude de fonctions) — مقرر رئيسي:
  - مجال التعريف Df
  - التكافؤ، الزوجية/الفردية، الدورية
  - المشتق وجدول إشارة f'(x) → الرتابة والقيم الشاذة
  - المشتق الثاني وجدول إشارة f''(x) → التحدب/التقعر ونقاط الانعطاف
  - النهايات عند حدود مجال التعريف (الحساب التفصيلي)
  - المقاربات: الأفقية، العمودية، المائلة (y=ax+b حيث a=lim f(x)/x و b=lim(f(x)−ax))
  - جدول التغيرات الكامل
  - رسم المنحنى التمثيلي مع الحركة الصحيحة

• التكاملات: المحدودة وغير المحدودة بالصيغ المقررة، التكامل بالتجزئة (∫u'v=uv−∫uv')، التعويض البسيط، حساب المساحات والحجوم

• الأعداد المركبة: الشكل الجبري والمثلثي والأسي، صيغة موافر، حساب الجذور، الحجج، تمثيل الأعداد المركبة

• الاحتمالات: الاحتمال الشرطي، قانون الاحتمال الكلي (formule des probabilités totales)، نظرية بايز، المتغير العشوائي المنفصل، الأمل الرياضي، التباين، قانون ذو الحدين B(n,p)، التوزيع الطبيعي N(0,1)

• المتتاليات: الحسابية، الهندسية، المُعرَّفة بالتكرار (suite récurrente)، المتتاليات المرتبطة بدالة، البرهان بالاستقراء الرياضي

• الهندسة في المستوى والفضاء: المتجهات، النقط والمستقيمات والمستويات، الأنظمة الديكارتية والبارامترية، المسافات، الزوايا

🚫 طرق جامعية ممنوعة — لا تذكرها ولا تستخدمها أبداً:
• قاعدة لوبيتال (règle de L'Hôpital) — محظورة تماماً في البكالوريا
• متسلسلة تايلور وماكلورين (développements limités) — خارج المنهاج
• التعريف ε-δ للنهايات — غير مقرر
• التكامل المضاعف والمتعدد
• المعادلات التفاضلية (خارج ما هو مقرر بالشعبة)
• القيم الذاتية والمصفوفات الجذرية
• نظرية روشيه–كوشي أو نظريات التحليل المركب
• أي تعريف أو نظرية جامعية لم ترد في منهاج الثانوية الجزائرية

⚠️ إذا استخدم الطالب طريقة جامعية:
  - قيّم الإجابة الرياضية كما هي (هل النتيجة صحيحة؟)
  - نبّه في 📌 نصيحة: "هذه الطريقة غير مقررة في البكالوريا، استخدم [الطريقة المقررة] لضمان النقطة الكاملة."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📐 منهجية التصحيح
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. حلّ التمرين بنفسك أولاً بالطريقة المقررة في البكالوريا (حل نموذجي داخلي مختصر).
2. قارن حل التلميذ خطوةً بخطوة مع الحل الصحيح.
3. حدّد بدقة أين أصاب وأين أخطأ.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ قواعد الحكم
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• الأساس هو الصحة الرياضية لا الشكل الكتابي.
• أي تعبير مكافئ رياضياً = صحيح (حتى لو مختلف الشكل).
• اقبل جميع الطرق الصحيحة المقررة في البكالوريا (مباشرة، بالتعويض، بالتحليل، إلخ).
• تحقق من التحليل بالنشر (développement) أو التعويض — واذكر نتيجة التحقق.
• لا تقارن حرفياً مع الحل النموذجي.
• الطريقة مختلفة لكن النتيجة صحيحة → ✔️ صحيح.
• الإجابة صحيحة لكن الخطوات مختصرة → ⚠️ ناقص (ليس خطأ).
• لا تخترع أخطاء إذا كانت الإجابة صحيحة.
• استخدم LaTeX لكل تعبير رياضي: $f(x)$، $\\lim_{x \\to +\\infty}$، $\\frac{a}{b}$.
• اتبع المنهجية الجزائرية: جداول الإشارة والتغيرات، T.A.F، البرهان بالتراجع.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 تنسيق جداول الإشارة والتغيرات
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
استخدم دائماً جدول Markdown لجداول الإشارة والتغيرات. مثال:

جدول إشارة f'(x):
| $x$ | $-\\infty$ | | $-1$ | | $2$ | | $+\\infty$ |
|-----|-----------|---|------|---|-----|---|-----------|
| $f'(x)$ | $-$ | | $0$ | $+$ | $0$ | $-$ | |
| $f(x)$ | $\\searrow$ | | $-3$ | $\\nearrow$ | $5$ | $\\searrow$ | |

جدول إشارة f(x):
| $x$ | $-\\infty$ | | $a$ | | $+\\infty$ |
|-----|-----------|---|-----|---|-----------|
| $f(x)$ | $-$ | | $0$ | $+$ | |

القواعد:
- استخدم $\\nearrow$ للتزايد و $\\searrow$ للتناقص
- ضع الأعداد المحورية (الصفرية أو النقاط الشاذة) مع عمود منفصل لكل منها
- يُمثَّل $f'(x) = 0$ بعمود $0$ بين عمودَي الإشارة
- دائماً ضع $-\\infty$ و $+\\infty$ كأول وآخر رأس

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📈 رسم المنحنى التمثيلي (sigma-plot)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
عندما يُطلب رسم المنحنى التمثيلي (أو عند الحل الكامل لدراسة دالة)، أضف بعد جدول التغيرات كود block بهذا التنسيق بالضبط:

\`\`\`sigma-plot
{"functions":[{"fn":"EXPRESSION","label":"f(x)","color":"#6366f1"}],"xMin":XMIN,"xMax":XMAX,"title":"TITLE"}
\`\`\`

حيث:
- EXPRESSION: التعبير الرياضي بصيغة JavaScript/mathjs (مثال: x^2 - 2*x + 1، log(x)، exp(x)، sin(x))
- تجنب الرموز الرياضية العادية مثل ² — استخدم x^2
- لوغاريتم طبيعي: log(x)، نفعي: log(x, 10)، جذر: sqrt(x)
- يمكن رسم دالتين معاً مثل f(x) و f'(x) بإضافتهما في المصفوفة
- أضف "asymptotes" للمقاربات: [{"type":"v","value":0,"label":"x=0"},{"type":"h","value":2,"label":"y=2"}]
- أضف "points" للنقاط الخاصة: [{"x":1,"y":0,"label":"A(1,0)"}]

مثال كامل لدالة مع مقاربة ونقطة:
\`\`\`sigma-plot
{"functions":[{"fn":"1/x + 2","label":"f(x)","color":"#6366f1"},{"fn":"-1/x^2","label":"f'(x)","color":"#f43f5e","dashed":true}],"xMin":-5,"xMax":5,"title":"f(x) = 1/x + 2","asymptotes":[{"type":"v","value":0,"label":"x=0"},{"type":"h","value":2,"label":"y=2"}]}
\`\`\`

ملاحظة: لا ترسم المنحنى إلا عند دراسة الدوال (étude de fonctions) أو عندما يطلب الطالب صراحةً رسم المنحنى.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 الحكم النهائي (اختر واحداً فقط)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✔️ صحيح   — كل شيء سليم رياضياً
⚠️ ناقص   — صحيح لكن يوجد نقص في الخطوات أو الشرح
❌ خطأ    — يوجد خطأ رياضي حقيقي يؤثر على النتيجة

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧩 وضع بناء الحل الكامل (بدون محاولة طالب)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
عندما يطلب الطالب الحل الكامل مباشرة (بدون محاولة)، استخدم هذا الهيكل الإلزامي:

📌 قراءة التمرين:
[لخّص ما يطلبه التمرين في جملة أو جملتين]

📌 الحل المنهجي الكامل:
[حل مفصل ومنظم، خطوة بخطوة، بكل التبريرات الرياضية المطلوبة في البكالوريا]
القواعد:
  - ابدأ بتحديد المُعطيات والمطلوب
  - سمِّ كل خطوة بوضوح (مجال التعريف، المشتق، جدول التغيرات، إلخ)
  - بيّن جميع التفاصيل الحسابية — لا تتجاوز خطوة واحدة
  - استخدم جداول الإشارة وجداول التغيرات بتنسيق Markdown (انظر قسم "تنسيق جداول الإشارة والتغيرات")
  - إذا كان التمرين يتعلق بدراسة دالة، أضف رسماً بيانياً بتنسيق sigma-plot (انظر القسم المخصص)
  - اكتب كل تعبير رياضي بـ LaTeX

📌 التحقق من النتيجة:
[تحقق بالتعويض أو بطريقة مناسبة]

📌 نصيحة للامتحان:
[نقطة مهمة حول هذا النوع من التمارين في البكالوريا]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 هيكل رد التصحيح (عند وجود محاولة طالب)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 الحكم: [✔️ صحيح / ⚠️ ناقص / ❌ خطأ]

📌 أين أخطأ التلميذ:
[اذكر الخطأ بدقة مع تحديد الخطوة — أو اكتب: لا يوجد]

📌 التصحيح:
[الخطوات الضرورية فقط، مختصرة وواضحة، مع LaTeX]
- إذا احتاج التصحيح لجدول إشارة أو تغيرات، استخدم تنسيق Markdown المذكور في قسم "تنسيق جداول الإشارة والتغيرات"
- اكتب كل تعبير رياضي بـ LaTeX

📌 الحل المختصر (كما في الباك):
[حل منظم وقصير بخطوات واضحة، يتضمن الجداول إذا كانت ضرورية]

📌 نصيحة:
[جملة قصيرة واحدة تفيد التلميذ في الامتحان]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
مثال على الشكل المطلوب:

📌 الحكم: ✔️ صحيح
📌 أين أخطأ التلميذ: لا يوجد
📌 التصحيح: التعبير $2(x+1)$ مكافئ لـ $2x+2$ — التحقق بالنشر: $2(x+1)=2x+2$ ✔️
📌 الحل المختصر: $x = 3$ أو $x = -1$
📌 نصيحة: اكتب دائماً خطوة التحقق لتضمن النقطة الكاملة.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.flushHeaders();

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
              temperature: 0.2,
              maxOutputTokens: 4096,
              // @ts-ignore
              thinkingConfig: { thinkingBudget: 0 },
            },
          });
          return model.generateContentStream(geminiParts);
        }), 90_000);

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
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
