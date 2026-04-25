import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";

const SECTIONS = [
  {
    title: "1. وصف التطبيق",
    content: [
      "سِيغْمَا (SIGMA Σ) هو تطبيق تعليمي مستقل يساعد طلاب البكالوريا الجزائرية على تصحيح تمارين الرياضيات باستخدام الذكاء الاصطناعي.",
      "المحتوى المُنتَج هو تصحيح مساعد ولا يُمثّل نموذج إجابة رسمياً.",
    ],
  },
  {
    title: "2. الملكية الفكرية",
    content: [
      "جميع حقوق تطبيق سِيغْمَا (الشيفرة، الواجهة، الشعار) محفوظة لمطوّريه. يُحظر نسخ التطبيق أو توزيعه أو إعادة بيعه بأي شكل.",
      "الصور والتمارين التي يرفعها المستخدم هي ملكيته. التطبيق لا يدّعي ملكيتها ولا يحتفظ بها بعد انتهاء طلب التصحيح.",
      "التطبيق لا يحتوي على أسئلة امتحانات رسمية مُدرجة فيه. التمارين تأتي من المستخدم فقط.",
    ],
  },
  {
    title: "3. الاشتراك والدفع",
    content: [
      "يُتيح التطبيق 3 تصحيحات مجانية لكل جهاز. للاستمرار يلزم اشتراك مدفوع.",
      "رسوم التفعيل تُدفع مرة واحدة عبر بريدي موب أو CCP. لا يوجد اشتراك متكرر تلقائي.",
      "المدفوعات غير قابلة للاسترداد بعد التفعيل الناجح للحساب.",
      "بريدي موب وبريد الجزائر علامتان تجاريتان لمؤسسة بريد الجزائر. التطبيق يذكرهما كوسيلة دفع فقط وليس شريكاً رسمياً لها.",
    ],
  },
  {
    title: "4. حدود المسؤولية",
    content: [
      "التصحيح المُنتَج بالذكاء الاصطناعي للمساعدة التعليمية فقط. يجب على المستخدم التحقق من النتائج مع أستاذه.",
      "لا يتحمل التطبيق مسؤولية أي خسارة أكاديمية ناتجة عن الاعتماد الكلي على نتائج التصحيح.",
      "خدمة الذكاء الاصطناعي مقدَّمة عبر Google Gemini API. Google هي علامة تجارية مسجّلة لـ Google LLC. التطبيق لا علاقة تجارية أو رسمية له بـ Google.",
    ],
  },
  {
    title: "5. السلوك المقبول",
    content: [
      "يُحظر استخدام التطبيق لأغراض غير تعليمية أو لأي نشاط مخالف للقانون الجزائري.",
      "يُحظر محاولة التحايل على نظام التفعيل أو مشاركة بيانات الحساب مع الغير.",
      "رفع صور لا علاقة لها بالرياضيات أو بالبكالوريا يؤدي إلى تجميد الحساب.",
    ],
  },
  {
    title: "6. التعديلات والإيقاف",
    content: [
      "يحق للمطوّر تعديل هذه الشروط في أي وقت. سيُعلَن عن التعديلات الجوهرية داخل التطبيق.",
      "يحق للمطوّر تعليق حساب أي مستخدم يُثبت انتهاكه لهذه الشروط.",
    ],
  },
  {
    title: "7. التواصل والاستفسارات",
    content: [
      "لأي استفسار قانوني أو تقني، يمكنك مراسلتنا عبر البريد الإلكتروني:",
    ],
    email: "wadjed.n.merada@ens-lagh.dz",
  },
];

function renderContent(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-foreground">{part}</strong> : part
  );
}

export default function Terms() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col" dir="rtl">
      <div className="max-w-2xl mx-auto w-full px-5 py-10 flex-1">

        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-8"
        >
          <ArrowRight className="w-4 h-4" />
          العودة
        </button>

        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center text-white font-black text-lg">Σ</div>
          <h1 className="text-2xl font-black text-foreground">شروط الاستخدام</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-8 mr-12">
          سِيغْمَا Σ &nbsp;|&nbsp; آخر تحديث: أبريل 2026
        </p>

        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 mb-8">
          <p className="text-sm text-foreground/80 leading-relaxed">
            <strong className="text-foreground">تنبيه:</strong> تطبيق سِيغْمَا أداة تعليمية مستقلة. استخدام التطبيق يعني موافقتك على هذه الشروط.
          </p>
        </div>

        <div className="space-y-7">
          {SECTIONS.map((sec) => (
            <section key={sec.title} className="space-y-2">
              <h2 className="font-bold text-base text-foreground">{sec.title}</h2>
              <ul className="space-y-1.5">
                {sec.content.map((item, i) => (
                  <li key={i} className="text-sm leading-relaxed text-foreground/80 flex gap-2">
                    <span className="text-indigo-400 mt-0.5 shrink-0">•</span>
                    <span>{renderContent(item)}</span>
                  </li>
                ))}
                {"email" in sec && sec.email && (
                  <li className="text-sm leading-relaxed text-foreground/80 flex gap-2 mt-1">
                    <span className="text-indigo-400 mt-0.5 shrink-0">📧</span>
                    <a
                      href={`mailto:${sec.email}`}
                      className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition-colors font-medium"
                    >
                      {sec.email}
                    </a>
                  </li>
                )}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-border text-xs text-muted-foreground text-center space-y-1">
          <p>سِيغْمَا Σ — جميع الحقوق محفوظة 2026</p>
          <p className="text-indigo-400/70">صفحة شروط الاستخدام</p>
        </div>
      </div>
    </div>
  );
}
