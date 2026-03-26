import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";

export default function Privacy() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="max-w-2xl mx-auto w-full px-6 py-10 flex-1">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors mb-8"
        >
          <ArrowRight className="w-4 h-4" />
          العودة
        </button>

        <h1 className="text-2xl font-black text-foreground mb-2">سياسة الخصوصية</h1>
        <p className="text-xs text-muted-foreground mb-8">Privacy Policy — سِيغْمَا Σ 2026</p>

        <div className="space-y-6 text-sm leading-relaxed text-foreground/85">

          <section className="space-y-2">
            <h2 className="font-bold text-base text-foreground">1. البيانات التي نجمعها</h2>
            <p>عند استخدامك للتطبيق، نتعامل مع الصور التي ترفعها لغرض التصحيح التلقائي فقط. لا نحتفظ بأي صورة أو محتوى بعد انتهاء جلسة التصحيح.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-base text-foreground">2. كيف نستخدم بياناتك</h2>
            <p>الصور المرفوعة تُرسل مباشرةً إلى نموذج الذكاء الاصطناعي لإنتاج التصحيح، ولا تُستخدم لأي غرض آخر. لا نبيع بياناتك ولا نشاركها مع أطراف ثالثة.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-base text-foreground">3. التخزين المحلي</h2>
            <p>يحتفظ التطبيق ببعض التفضيلات (مثل الوضع الليلي) في ذاكرة المتصفح المحلية فقط، ولا تُرسل إلى أي خادم.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-base text-foreground">4. الأمان والتشفير</h2>
            <p>جميع الاتصالات بين التطبيق والخادم مشفرة عبر بروتوكول HTTPS. نلتزم بمعايير الخصوصية المعتمدة لحماية بياناتك.</p>
          </section>

          <section className="space-y-2">
            <h2 className="font-bold text-base text-foreground">5. حقوقك</h2>
            <p>لك الحق في التوقف عن استخدام التطبيق في أي وقت. لأي استفسار يتعلق بخصوصيتك، يمكنك التواصل معنا مباشرةً.</p>
          </section>

        </div>

        <div className="mt-10 pt-6 border-t border-border text-xs text-muted-foreground text-center">
          سِيغْمَا Σ — جميع الحقوق محفوظة 2026
        </div>
      </div>
    </div>
  );
}
