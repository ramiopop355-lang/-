import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";

const SECTIONS = [
  {
    title: "1. البيانات التي نجمعها",
    content: [
      "**بيانات الحساب:** عند التسجيل، نحتفظ باسم المستخدم ورقم الهاتف وكلمة مرور مشفّرة (bcrypt). لا نطلب الاسم الكامل أو البريد الإلكتروني.",
      "**صور التمارين:** الصور التي ترفعها تُرسل مباشرةً إلى نموذج الذكاء الاصطناعي للتصحيح ولا تُحفظ على خوادمنا بعد انتهاء الطلب.",
      "**بيانات الإشعارات:** إذا وافقت على استقبال الإشعارات على Android، نحتفظ بمعرّف اشتراك الإشعارات مرتبطاً بحسابك.",
      "**التفضيلات المحلية:** الوضع الليلي وتاريخ الاستخدام تُخزَّن في المتصفح فقط ولا تُرسل إلى أي خادم.",
    ],
  },
  {
    title: "2. كيف نستخدم بياناتك",
    content: [
      "تسجيل الدخول والتحقق من الاشتراك.",
      "إرسال الصور إلى نموذج الذكاء الاصطناعي لإنتاج التصحيح التلقائي.",
      "إرسال إشعارات مفيدة (تذكيرات موعد البكالوريا، انتهاء الاشتراك) عبر Web Push.",
      "لا نبيع بياناتك ولا نشاركها مع أطراف ثالثة تحت أي ظرف.",
    ],
  },
  {
    title: "3. مشاركة البيانات مع أطراف ثالثة",
    content: [
      "**Google Gemini AI:** الصور المرفوعة تُمرَّر لنموذج Gemini لإنتاج التصحيح. تخضع هذه البيانات لسياسة خصوصية Google.",
      "لا توجد أي أطراف ثالثة أخرى تتلقى بياناتك.",
    ],
  },
  {
    title: "4. الأمان والتشفير",
    content: [
      "جميع الاتصالات مشفرة عبر HTTPS/TLS.",
      "كلمات المرور مشفرة بخوارزمية bcrypt ولا يمكن لأحد الاطلاع عليها بما فينا نحن.",
      "توكنات الجلسة (JWT) تنتهي صلاحيتها تلقائياً.",
    ],
  },
  {
    title: "5. حقوقك وحذف البيانات",
    content: [
      "**حق الوصول:** يمكنك طلب معرفة البيانات المحفوظة عنك.",
      "**حق الحذف:** يمكنك طلب حذف حسابك وجميع بياناتك نهائياً في أي وقت.",
      "**إلغاء الإشعارات:** يمكنك إلغاء إذن الإشعارات من إعدادات جهازك في أي وقت.",
      "للتواصل بخصوص أي من هذه الحقوق، راسلنا على العنوان أدناه.",
    ],
  },
  {
    title: "6. التواصل والاستفسارات",
    content: [
      "لأي سؤال أو طلب متعلق بخصوصيتك، يمكنك التواصل معنا عبر البريد الإلكتروني:",
      "📧 sigma.bac.dz@gmail.com",
    ],
  },
];

function renderContent(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? <strong key={i} className="text-foreground">{part}</strong> : part
  );
}

export default function Privacy() {
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
          <h1 className="text-2xl font-black text-foreground">سياسة الخصوصية</h1>
        </div>
        <p className="text-xs text-muted-foreground mb-8 mr-12">
          Privacy Policy — سِيغْمَا Σ &nbsp;|&nbsp; آخر تحديث: مارس 2026
        </p>

        <p className="text-sm text-foreground/80 leading-relaxed mb-8 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
          تصف هذه السياسة كيفية جمع واستخدام وحماية بياناتك عند استخدام تطبيق <strong className="text-foreground">سِيغْمَا</strong> لتصحيح رياضيات البكالوريا الجزائرية.
        </p>

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
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-12 pt-6 border-t border-border text-xs text-muted-foreground text-center space-y-1">
          <p>سِيغْمَا Σ — جميع الحقوق محفوظة 2026</p>
          <p className="text-indigo-400/70">sigmaaidzbac.replit.app/privacy</p>
        </div>
      </div>
    </div>
  );
}
