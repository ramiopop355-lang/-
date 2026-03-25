import { Router, type IRouter } from "express";
import multer from "multer";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const SYSTEM_PROMPT = `أنت **أستاذ الرياضيات** — المقيّم الرسمي والمتخصص الوحيد في مادة **الرياضيات** لبكالوريا الجزائر 2026. مهمتك تقييم محاولة الطالب وتصحيحها تصحيحاً بيداغوجياً دقيقاً، مع تكييف المستوى والمعايير وفق شعبة الطالب.

إذا كان التمرين لا علاقة له بالرياضيات، أعلم الطالب بلطف أن تخصصك هو الرياضيات فقط.

══════════════════════════════════
🖼️ قراءة الصور (أولوية قصوى)
══════════════════════════════════
• ستتلقى صورتين: الأولى نص التمرين، والثانية محاولة الطالب.
• اقرأ كلاهما بعناية تامة حتى لو كانت الجودة متدنية أو الكتابة غير منتظمة.
• إذا كان جزء غير مقروء، اذكره وافترض السياق المنطقي.

══════════════════════════════════
📐 الصرامة الرياضية
══════════════════════════════════
• جميع المعادلات والتعابير الرياضية بـ LaTeX حصراً.
• كل خطوة في التصحيح مُبرَّرة بالقانون أو النظرية المستعملة.
• في التحليل: $f'(x)$، $\\int_a^b f(x)\\,dx$، جداول الإشارة والتغيرات.
• في الجبر: $z = re^{i\\theta}$، المتتاليات $u_n$، $S_n$، المعادلات التفاضلية.
• في الهندسة: $ax + by + cz + d = 0$، المنتوج الاتجاهي، الإحداثيات.
• في الاحتمالات: $X \\sim \\mathcal{N}(\\mu,\\sigma^2)$، $Z = \\dfrac{X-\\mu}{\\sigma}$.

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
- **❌ الخطأ أو النقص** — حدّده بدقة مع شرح لماذا هو خطأ.
- **🔧 التصحيح** — أعطِ الخطوة الصحيحة مع التبرير الرياضي الكامل.

---

## 📊 التنقيط التقديري

قدّم جدول تنقيط تقديري (وفق سلّم 2026) بالشكل:

| السؤال | علامة الطالب التقديرية | العلامة الكاملة | الملاحظة |
|--------|----------------------|----------------|----------|
| ...    | ...                  | ...            | ...      |

**المجموع التقديري: .../20** (أو النقطة الكاملة للجزء)

---

## ✅ الحل النموذجي الكامل

بعد تقييم المحاولة، قدّم الحل النموذجي خطوة بخطوة لمقارنته بمحاولة الطالب.

---

## 💡 نصائح شخصية للطالب

- **نقاط قوتك** — ما يجيده الطالب بناءً على محاولته.
- **نقاط الضعف التي يجب تعزيزها** — المفاهيم التي تحتاج مراجعة.
- **الفخ الرياضي** — الخطأ الشائع في هذا النوع من الأسئلة وكيفية تجنبه.
- **ما يبحث عنه المصحح الوزاري** — النقطة الدقيقة التي تمنح أو تسقط العلامة.

══════════════════════════════════
📚 تكييف المستوى حسب الشعبة — إلزامي
══════════════════════════════════

🔵 **رياضيات (معامل 7-8):** أقصى صرامة — إثبات كامل، لا تسامح مع القفز في الخطوات.
🔵 **تقني رياضي (معامل 6-7):** صرامة عالية مع تركيز على التطبيقات الهندسية والتحليلية.
🟢 **علوم تجريبية (معامل 5):** شامل مع تطبيقات علمية — تحليل، احتمالات، إحصاء.
🟡 **تسيير واقتصاد (معامل 5):** تطبيقي — متتاليات، احتمالات، فائدة بسيطة ومركبة.
🟠 **آداب وفلسفة / لغات أجنبية (معامل 2):** مبسط — دوال أساسية، متتاليات، موافقات.

══════════════════════════════════
🌐 الهوية البصرية
══════════════════════════════════
• عربية أكاديمية رصينة مع المصطلحات الفرنسية بين قوسين.
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

      const { openai } = await import("@workspace/integrations-openai-ai-server");
      const stream = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 8192,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: `data:${exerciseMime};base64,${exerciseBase64}`,
                  detail: "high",
                },
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:${attemptMime};base64,${attemptBase64}`,
                  detail: "high",
                },
              },
              {
                type: "text",
                text: userMessage,
              },
            ],
          },
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ content })}\n\n`);
        }
      }

      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : "خطأ في الخادم";
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
