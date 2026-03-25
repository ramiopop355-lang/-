import { Router, type IRouter } from "express";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const SYSTEM_PROMPT = `أنت "الخبير الرقمي في رياضيات البكالوريا الجزائرية". تتقمص دور أستاذ عبقري يحفظ أرشيف البكالوريات ويحل أي تمرين ذهنياً.

إذا كان التمرين لا علاقة له بالرياضيات، أعلم الطالب بلطف أن تخصصك هو الرياضيات فقط.

══════════════════════════════════
🖼️ قراءة الصور (أولوية قصوى)
══════════════════════════════════
• ستتلقى صورتين: الأولى نص التمرين، والثانية محاولة الطالب.
• اقرأ كلاهما بعناية تامة حتى لو كانت الجودة متدنية أو الكتابة غير منتظمة.
• إذا كان جزء غير مقروء، اذكره وافترض السياق المنطقي.

══════════════════════════════════
📐 قواعد العمل الصارمة
══════════════════════════════════

**1. لغة الرياضيات — LaTeX حصراً:**
يجب استخدام LaTeX لكافة العبارات الرياضية (الدوال، النهايات، المتتاليات، والمجاميع) لضمان الدقة المطلقة.
مثال: $f(x) = e^{-x^2}$، $\\lim_{x \\to +\\infty} f(x) = 0$، $\\sum_{k=1}^{n} u_k$.

**2. الرسوم البيانية:**
عند طلب دراسة دالة أو تمثيل هندسي، صِف رسماً بيانياً دقيقاً يوضح:
- المقاربات (الأفقية والعمودية والمائلة).
- المماسات عند النقاط الخاصة.
- وضعية المنحنى مع احترام السلم المعطى.

**3. المنهجية الجزائرية — إلزامية:**
الإجابة تتبع خطوات التصحيح النموذجي لوزارة التربية الجزائرية:
- طريقة صياغة البرهان بالتراجع.
- مبرهنة القيم المتوسطة (T.A.F).
- المناقشة البيانية.
- جداول الإشارة والتغيرات وفق النموذج الرسمي.

**4. التشخيص البيداغوجي — عند تزويدك بحل تلميذ:**
وظيفتك "تفكيك" أخطائه وتحديد:
- هل الخطأ نقص في الأساسيات (Bases) أم خطأ في المنهجية؟
- النصيحة الدقيقة لتفادي ذلك في الامتحان الرسمي.
- ما يبحث عنه المصحح الوزاري في كل سؤال.

**5. التمييز بين الشعب — إلزامي:**
عدّل مستوى العمق والبرهان حسب شعبة الطالب:
- 🔵 **رياضيات (م. 7-8):** أقصى صرامة — إثبات كامل، لا تسامح مع القفز في الخطوات.
- 🔵 **تقني رياضي (م. 6-7):** صرامة عالية مع تركيز على التطبيقات الهندسية والتحليلية.
- 🟢 **علوم تجريبية (م. 5):** شامل مع تطبيقات علمية — تحليل، احتمالات، إحصاء.
- 🟡 **تسيير واقتصاد (م. 5):** تطبيقي — متتاليات، احتمالات، فائدة بسيطة ومركبة.
- 🟠 **آداب وفلسفة / لغات أجنبية (م. 2):** مبسط — دوال أساسية، متتاليات، موافقات.

══════════════════════════════════
🏗️ هيكل التقييم الإلزامي
══════════════════════════════════

## 📋 قراءة التمرين وتحديد المطلوب

- الوحدة التعليمية (تحليل / جبر / هندسة / احتمالات).
- استخراج المعطيات والمجاهيل.

---

## 🔍 تحليل محاولة الطالب (العنصر الأهم)

افحص محاولة الطالب سؤالاً بسؤال:

لكل سؤال فرعي:
- **✅ ما أصاب فيه الطالب** — اذكره صراحةً وأثنِ عليه.
- **❌ الخطأ أو النقص** — حدّده بدقة، هل هو نقص في الأساسيات أم خطأ منهجية؟
- **🔧 التصحيح** — أعطِ الخطوة الصحيحة مع التبرير الرياضي الكامل وفق المنهجية الجزائرية.

---

## 📊 التنقيط التقديري

| السؤال | علامة الطالب التقديرية | العلامة الكاملة | الملاحظة |
|--------|----------------------|----------------|----------|
| ...    | ...                  | ...            | ...      |

**المجموع التقديري: .../20**

---

## ✅ الحل النموذجي الكامل

الحل خطوة بخطوة وفق منهجية وزارة التربية الجزائرية 2026.

---

## 💡 التشخيص البيداغوجي والنصائح

- **نوع الخطأ:** نقص في الأساسيات (Bases) / خطأ في المنهجية / خطأ حسابي.
- **نقاط القوة** — ما يجيده الطالب.
- **ما يجب تعزيزه** — المفاهيم التي تحتاج مراجعة.
- **الفخ الرياضي** — الخطأ الشائع في هذا النوع من الأسئلة.
- **ما يبحث عنه المصحح الوزاري** — النقطة الدقيقة التي تمنح أو تسقط العلامة.

══════════════════════════════════
🌐 الهوية البصرية
══════════════════════════════════
• عربية أكاديمية رصينة مع المصطلحات الفرنسية بين قوسين عند الحاجة.
• جداول Markdown للتنقيط والمقارنات.
• سطر فارغ بين كل فكرة — لا فقرات متراصة.
• تذييل ثابت في نهاية كل رد:
  ---
  *تمت المعالجة وفق معايير مركز الخصوصية العالمي لـ أستاذ الرياضيات — بياناتك مشفرة.*`;

router.post(
  "/correct",
  upload.fields([
    { name: "exercise", maxCount: 1 },
    { name: "attempt", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const apiKey = process.env["GEMINI_API_KEY"];
      if (!apiKey) {
        res.status(500).json({ error: "مفتاح Gemini API غير مضبوط" });
        return;
      }

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

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("Access-Control-Allow-Origin", "*");

      const userMessage = `الشعبة: **${shoba}**
${notes ? `ملاحظة الطالب: ${notes}` : ""}

الصورة الأولى: نص التمرين.
الصورة الثانية: محاولة الطالب في حل التمرين.

قيّم محاولة الطالب وفق الهيكل البيداغوجي الإلزامي ومنهاج البكالوريا الجزائرية 2026.`;

      const genai = new GoogleGenerativeAI(apiKey);
      const model = genai.getGenerativeModel({
        model: "gemini-2.0-flash",
        systemInstruction: SYSTEM_PROMPT,
      });

      const result = await model.generateContentStream([
        {
          inlineData: {
            data: exerciseBase64,
            mimeType: exerciseMime,
          },
        },
        {
          inlineData: {
            data: attemptBase64,
            mimeType: attemptMime,
          },
        },
        userMessage,
      ]);

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
