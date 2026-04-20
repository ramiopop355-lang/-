import { useState, useEffect } from "react";
import { useAuth, getDeviceId, getDeviceName } from "@/context/AuthContext";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogIn, ShieldCheck, Moon, Sun,
  Check, Copy, ArrowLeft, UserPlus, Eye, EyeOff, User, Phone, Lock,
  Sparkles, Gift, Upload, CheckCircle2, Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDarkModeToggle } from "@/hooks/use-dark-mode";

function RIPCopyField({ rip }: { rip: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(rip);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <button
      onClick={handleCopy}
      className="w-full flex items-center justify-between gap-3 bg-muted border border-border hover:border-primary/40 rounded-xl px-4 py-3 transition-all group"
    >
      <span className="font-mono text-sm text-foreground tracking-wide select-all">{rip}</span>
      <span className="shrink-0 text-muted-foreground group-hover:text-primary transition-colors">
        {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
      </span>
    </button>
  );
}

function InputField({
  icon: Icon, label, type = "text", value, onChange, placeholder, disabled, showToggle, autoComplete,
}: {
  icon: React.ElementType; label: string; type?: string; value: string;
  onChange: (v: string) => void; placeholder?: string; disabled?: boolean; showToggle?: boolean; autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  const inputType = showToggle ? (visible ? "text" : "password") : type;
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground">{label}</label>
      <div className="relative flex items-center">
        <div className="absolute right-3 text-muted-foreground pointer-events-none">
          <Icon className="w-4 h-4" />
        </div>
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete={autoComplete}
          className="w-full bg-muted border border-border rounded-xl px-4 py-2.5 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:ring-1 focus:ring-primary/30 transition-all disabled:opacity-50"
          dir="rtl"
        />
        {showToggle && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute left-3 text-muted-foreground hover:text-foreground transition-colors"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Login() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [showPayment, setShowPayment] = useState(false);
  const [payStep, setPayStep] = useState<1 | 2>(1);
  const [paymentMethod, setPaymentMethod] = useState<"baridimob" | "ccp">("baridimob");
  const [isUploading, setIsUploading] = useState(false);
  const [ccpVerifying, setCcpVerifying] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regUsername, setRegUsername] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");

  const { login, token: authToken, updateUser, user, isLoggedIn } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isDark, toggle } = useDarkModeToggle();

  useEffect(() => {
    if (isLoggedIn) setLocation("/");
  }, [isLoggedIn, setLocation]);

  const handleLogin = async () => {
    if (!loginUsername.trim() || !loginPassword) {
      toast({ title: "خطأ", description: "أدخل اسم المستخدم وكلمة السر", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: loginUsername.trim(),
          password: loginPassword,
          deviceId: getDeviceId(),
          deviceName: getDeviceName(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        {
          toast({
            title: "فشل الدخول",
            description: (data.error ?? "خطأ غير معروف") + (res.status === 401 ? " — إذا لم تُسجِّل بعد، انقر على تبويب «تسجيل»" : ""),
            variant: "destructive",
            duration: 6000,
          });
        }
        return;
      }
      login(data.token, data.user);
      toast({ title: `مرحباً ${data.user.username}! 🎉`, description: "الباك راهو في الجيب، خلينا نبدأ." });
      setLocation("/");
    } catch {
      toast({ title: "خطأ في الاتصال", description: "تأكد من اتصالك بالإنترنت", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!regUsername.trim() || !regPhone.trim() || !regPassword || !regConfirm) {
      toast({ title: "خطأ", description: "أكمل جميع الحقول", variant: "destructive" });
      return;
    }
    if (regPassword !== regConfirm) {
      toast({ title: "خطأ", description: "كلمتا السر غير متطابقتين", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: regUsername.trim(), phone: regPhone.trim(), password: regPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "فشل التسجيل", description: data.error ?? "خطأ غير معروف", variant: "destructive" });
        return;
      }
      login(data.token, data.user);
      toast({ title: "تم إنشاء حسابك! 🎉", description: "يمكنك الآن استخدام التطبيق." });
      setLocation("/");
    } catch {
      toast({ title: "خطأ في الاتصال", description: "تأكد من اتصالك بالإنترنت", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!authToken || authToken === "trial") {
      toast({ title: "سجّل الدخول أولاً", description: "أنشئ حساباً أو ادخل إلى حسابك ثم افتح نافذة التفعيل", variant: "destructive" });
      return;
    }

    const form = new FormData();
    form.append("receipt", file);
    form.append("paymentMethod", paymentMethod);

    if (paymentMethod === "baridimob") {
      // بريدي موب — انتظر تأكيد الخادم قبل التفعيل
      setIsUploading(true);
      try {
        const res = await fetch("/api/auth/activate", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        });
        const data = await res.json();
        if (res.ok) {
          updateUser(data.token, data.user);
          setUploaded(true);
          toast({ title: "🎉 تم تفعيل حسابك!", description: "مبروك! يمكنك الآن الاستخدام غير المحدود." });
        } else {
          toast({ title: "❌ خطأ في التفعيل", description: data.error ?? "حاول مجدداً", variant: "destructive" });
        }
      } catch {
        toast({ title: "خطأ في الاتصال", description: "تأكد من اتصالك بالإنترنت وحاول مجدداً", variant: "destructive" });
      } finally {
        setIsUploading(false);
      }
    } else {
      // CCP — انتظار تحليل الذكاء الاصطناعي قبل التفعيل
      setIsUploading(true);
      setCcpVerifying(true);
      try {
        const res = await fetch("/api/auth/activate", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        });
        const data = await res.json();
        if (res.ok) {
          updateUser(data.token, data.user);
          setUploaded(true);
          toast({ title: "🎉 تم تفعيل حسابك!", description: "تم التحقق من وصل CCP. مبروك!" });
        } else {
          toast({ title: "خطأ في التفعيل", description: data.error ?? "حاول مجدداً", variant: "destructive" });
        }
      } catch {
        toast({ title: "خطأ في الاتصال", description: "تأكد من اتصالك بالإنترنت وحاول مجدداً", variant: "destructive" });
      } finally {
        setIsUploading(false);
        setCcpVerifying(false);
      }
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {/* خلفية احترافية */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute -top-48 -right-48 w-[520px] h-[520px]"
          style={{ borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 65%)", filter: "blur(55px)" }}
        />
        <div
          className="absolute -bottom-48 -left-48 w-[480px] h-[480px]"
          style={{ borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.16) 0%, transparent 65%)", filter: "blur(55px)" }}
        />
        <div
          className="absolute top-1/2 right-1/3 w-[350px] h-[200px]"
          style={{ borderRadius: "50%", background: "radial-gradient(ellipse, rgba(99,102,241,0.07) 0%, transparent 60%)", filter: "blur(40px)" }}
        />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.50, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm relative"
      >
        <div
          className="bg-card rounded-3xl overflow-hidden"
          style={{
            boxShadow: "0 0 0 1px rgba(99,102,241,0.12), 0 24px 56px -12px rgba(99,102,241,0.22), 0 8px 16px -4px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
        {/* شريط التدرج العلوي — professional top accent */}
        <div className="h-[3px] w-full" style={{ background: "linear-gradient(90deg, #6366f1 0%, #a78bfa 45%, #8b5cf6 100%)" }} />

          {/* Header */}
          <div className="px-8 pt-7 pb-5 text-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 240, damping: 18 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-3"
              style={{
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                boxShadow: "0 8px 24px rgba(99,102,241,0.35)",
              }}
            >
              <span className="text-3xl font-black text-white select-none" style={{ fontFamily: "serif", letterSpacing: "-1px" }}>Σ</span>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <h1 className="text-2xl font-black text-foreground tracking-tight mb-1">سِيغْمَا</h1>
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-primary/80">مصحح رياضيات البكالوريا بالذكاء الاصطناعي</p>
                <p className="text-xs text-muted-foreground">متوافق مع منهاج البكالوريا الجزائرية · 2026</p>
              </div>
            </motion.div>
          </div>

          <div className="h-px bg-border mx-6" />

          {/* Tabs */}
          <div className="px-6 pt-4">
            <div className="flex bg-muted rounded-xl p-1 gap-1">
              {([["login", "دخول", LogIn], ["register", "تسجيل", UserPlus]] as const).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${
                    tab === key
                      ? "bg-card text-foreground shadow-sm border border-border/60"
                      : "text-muted-foreground hover:text-foreground/80"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Form Content */}
          <div className="px-6 pt-4">
            <AnimatePresence mode="wait">
              {tab === "login" && (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.18 }}
                >
                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); handleLogin(); }}>
                    <InputField icon={User} label="اسم المستخدم" value={loginUsername} onChange={setLoginUsername} placeholder="أدخل اسم المستخدم" disabled={loading} autoComplete="username" />
                    <InputField icon={Lock} label="كلمة السر" value={loginPassword} onChange={setLoginPassword} placeholder="أدخل كلمة السر" disabled={loading} showToggle autoComplete="current-password" />
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-2.5 transition-all duration-200 shadow-sm shadow-primary/20 hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <LogIn className="w-4 h-4" />}
                      {loading ? "جاري الدخول..." : "دخول"}
                    </button>
                    <p className="text-center text-xs text-muted-foreground pb-1">
                      ليس لديك حساب؟{" "}
                      <button type="button" onClick={() => setTab("register")} className="text-primary font-bold hover:underline">سجّل الآن</button>
                    </p>
                  </form>
                </motion.div>
              )}

              {tab === "register" && (
                <motion.div
                  key="register"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.18 }}
                >
                  <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); handleRegister(); }}>
                    <InputField icon={User} label="اسم المستخدم" value={regUsername} onChange={setRegUsername} placeholder="اختر اسم مستخدم (3 أحرف +)" disabled={loading} autoComplete="username" />
                    <InputField icon={Phone} label="رقم الهاتف" value={regPhone} onChange={setRegPhone} placeholder="05XXXXXXXX" disabled={loading} autoComplete="tel" />
                    <InputField icon={Lock} label="كلمة السر" value={regPassword} onChange={setRegPassword} placeholder="6 أحرف على الأقل" disabled={loading} showToggle autoComplete="new-password" />
                    <InputField icon={Lock} label="تأكيد كلمة السر" value={regConfirm} onChange={setRegConfirm} placeholder="أعد إدخال كلمة السر" disabled={loading} showToggle autoComplete="new-password" />
                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-2.5 transition-all duration-200 shadow-sm shadow-primary/20 hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {loading ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : <UserPlus className="w-4 h-4" />}
                      {loading ? "جاري التسجيل..." : "إنشاء الحساب"}
                    </button>
                    <p className="text-center text-xs text-muted-foreground pb-1">
                      لديك حساب؟{" "}
                      <button type="button" onClick={() => setTab("login")} className="text-primary font-bold hover:underline">ادخل هنا</button>
                    </p>
                  </form>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Plans Section */}
          <div className="px-6 pb-5">
            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium">اختر خطتك</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Free Trial Card */}
              <div
                className="rounded-2xl p-3.5 flex flex-col gap-2 cursor-pointer hover:-translate-y-0.5 transition-all duration-200"
                style={{
                  background: "linear-gradient(135deg, rgba(34,197,94,0.10) 0%, rgba(16,185,129,0.05) 100%)",
                  border: "1.5px solid rgba(34,197,94,0.40)",
                }}
                onClick={() => { login("trial", { username: "زائر", phone: "", activated: false }); setLocation("/"); }}
              >
                <div className="flex items-center justify-between">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.15)" }}>
                    <Gift className="w-3.5 h-3.5" style={{ color: "#16a34a" }} />
                  </div>
                  <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(34,197,94,0.15)", color: "#16a34a" }}>
                    مجاني
                  </span>
                </div>
                <div>
                  <p className="text-xs font-black text-foreground leading-tight">النسخة التجريبية</p>
                  <p className="text-xs text-muted-foreground leading-tight mt-0.5">3 تصحيحات مجانية</p>
                </div>
                <div className="space-y-1 mt-0.5">
                  {["3 تصحيحات", "كل الشعب", "بدون دفع"].map(f => (
                    <div key={f} className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 shrink-0" style={{ color: "#22c55e" }} />
                      <span className="text-xs text-muted-foreground">{f}</span>
                    </div>
                  ))}
                </div>
                <button
                  className="w-full text-xs font-bold py-1.5 rounded-xl mt-1 transition-all"
                  style={{ background: "rgba(34,197,94,0.18)", color: "#16a34a" }}
                >
                  ابدأ مجاناً
                </button>
              </div>

              {/* Premium Card */}
              <div
                className="rounded-2xl p-3.5 flex flex-col gap-2 cursor-pointer hover:-translate-y-0.5 transition-all duration-200 relative overflow-hidden"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.13) 0%, rgba(139,92,246,0.07) 100%)",
                  border: "1.5px solid rgba(99,102,241,0.45)",
                  boxShadow: "0 2px 12px rgba(99,102,241,0.12)",
                }}
                onClick={() => setShowPayment(true)}
              >
                {/* Best value badge */}
                <div
                  className="absolute top-0 left-0 text-xs font-black px-2 py-0.5 rounded-br-xl"
                  style={{ background: "rgba(99,102,241,0.85)", color: "#fff", fontSize: "9px" }}
                >
                  ⭐ الأفضل
                </div>

                <div className="flex items-center justify-between mt-2">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "rgba(99,102,241,0.15)" }}>
                    <Sparkles className="w-3.5 h-3.5" style={{ color: "#6366f1" }} />
                  </div>
                  <div className="text-left flex flex-col items-end">
                    <span className="text-xs text-muted-foreground line-through leading-none">1000 دج</span>
                    <span className="text-base font-black leading-tight" style={{ color: "#6366f1" }}>500 دج</span>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-black text-foreground leading-tight">النسخة الكاملة</p>
                  <p className="text-xs text-muted-foreground leading-tight mt-0.5">عرض سنوي — وفّر 50٪</p>
                </div>
                <div className="space-y-1 mt-0.5">
                  {["تصحيحات غير محدودة", "ميزات حصرية", "أولوية في الدعم"].map(f => (
                    <div key={f} className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 shrink-0" style={{ color: "#6366f1" }} />
                      <span className="text-xs text-muted-foreground">{f}</span>
                    </div>
                  ))}
                </div>
                <button
                  className="w-full text-xs font-bold py-1.5 rounded-xl mt-1 transition-all text-white"
                  style={{ background: "rgba(99,102,241,0.85)", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}
                >
                  فعّل الآن ←
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                <span className="text-xs font-black text-white" style={{ fontFamily: "serif" }}>Σ</span>
              </div>
              <p className="text-xs text-muted-foreground">SIGMA © 2026</p>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <a href="/privacy" className="text-xs text-muted-foreground hover:text-primary transition-colors">Confidentialité</a>
              <span className="text-muted-foreground/40 text-xs">·</span>
              <a href="/terms" className="text-xs text-muted-foreground hover:text-primary transition-colors">Conditions d'utilisation</a>
            </div>
            <button
              onClick={toggle}
              className="w-7 h-7 rounded-full border border-border bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-border/80 transition-all"
              title={isDark ? "الوضع النهاري" : "الوضع الليلي"}
            >
              {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </motion.div>

      {/* ══════════════════ PAYMENT MODAL ══════════════════ */}
      <AnimatePresence>
        {showPayment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)" }}
            onClick={(e) => { if (e.target === e.currentTarget) { setShowPayment(false); setPayStep(1); setUploaded(false); setPaymentMethod("baridimob"); } }}
          >
            <motion.div
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 60 }}
              transition={{ type: "spring", stiffness: 340, damping: 32 }}
              className="w-full max-w-sm overflow-hidden"
              style={{
                borderRadius: "28px 28px 0 0",
                background: "hsl(var(--card))",
                boxShadow: "0 -8px 60px rgba(0,0,0,0.35)",
              }}
            >
              {/* ── شريط السحب ── */}
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full" style={{ background: "hsl(var(--border))" }} />
              </div>

              {/* ── رأس متدرج ── */}
              <div
                className="relative mx-4 mb-4 rounded-2xl overflow-hidden p-5"
                style={{
                  background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 55%, #6d28d9 100%)",
                }}
              >
                {/* نجوم خلفية */}
                <div className="absolute inset-0 opacity-10" style={{
                  backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
                  backgroundSize: "22px 22px",
                }} />

                <div className="relative flex items-start justify-between">
                  <div>
                    <p className="text-white/70 text-xs font-medium mb-0.5">النسخة الكاملة — عرض 2026</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-black text-white leading-none">500</span>
                      <span className="text-white/80 text-base font-bold">دج</span>
                      <span className="text-white/40 text-xs line-through mt-auto mb-0.5">1000</span>
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="bg-white/20 rounded-full px-2 py-0.5 text-white text-xs font-bold">وفّر 50٪</div>
                      <div className="bg-white/20 rounded-full px-2 py-0.5 text-white text-xs font-bold">تصحيحات غير محدودة</div>
                    </div>
                  </div>
                  <button
                    onClick={() => { setShowPayment(false); setPayStep(1); setUploaded(false); setPaymentMethod("baridimob"); }}
                    className="w-8 h-8 rounded-full flex items-center justify-center transition-all hover:scale-110"
                    style={{ background: "rgba(255,255,255,0.18)" }}
                  >
                    <span className="text-white text-lg leading-none">×</span>
                  </button>
                </div>

                {/* progress bar */}
                <div className="mt-4 flex gap-1.5">
                  <div className="h-1 flex-1 rounded-full" style={{ background: "rgba(255,255,255,0.9)" }} />
                  <div className="h-1 flex-1 rounded-full transition-all" style={{ background: payStep === 2 ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.3)" }} />
                </div>
                <div className="mt-1 flex justify-between text-white/50 text-[10px]">
                  <span>اختر طريقة الدفع</span>
                  <span>ارفع الوصل</span>
                </div>
              </div>

              {/* ── المحتوى ── */}
              <div className="px-4" style={{ paddingBottom: "calc(1.5rem + var(--safe-bottom))" }}>
                <AnimatePresence mode="wait">

                  {/* ════ الخطوة 1 ════ */}
                  {payStep === 1 && (
                    <motion.div key="s1" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }} className="space-y-3">

                      {/* طرق الدفع */}
                      <p className="text-xs text-muted-foreground font-semibold tracking-wide uppercase">طريقة الدفع</p>
                      <div className="grid grid-cols-2 gap-2.5">
                        {([
                          { id: "baridimob", label: "بريدي موب",        sub: "تفعيل فوري",          icon: "📱", color: "#f59e0b" },
                          { id: "ccp",       label: "CCP بريد الجزائر", sub: "تحقق بالذكاء الاصطناعي", icon: "🏦", color: "#6366f1" },
                        ] as const).map(({ id, label, sub, icon, color }) => {
                          const sel = paymentMethod === id;
                          return (
                            <button
                              key={id}
                              onClick={() => setPaymentMethod(id)}
                              className="relative flex flex-col gap-1.5 rounded-2xl p-3.5 text-right transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
                              style={{
                                border: sel ? `2px solid ${color}` : "2px solid hsl(var(--border))",
                                background: sel ? `${color}14` : "hsl(var(--muted)/0.5)",
                                boxShadow: sel ? `0 0 0 3px ${color}22, 0 4px 16px ${color}1a` : "none",
                              }}
                            >
                              {sel && (
                                <div
                                  className="absolute top-2 left-2 w-4 h-4 rounded-full flex items-center justify-center"
                                  style={{ background: color }}
                                >
                                  <Check className="w-2.5 h-2.5 text-white" />
                                </div>
                              )}
                              <span className="text-2xl leading-none">{icon}</span>
                              <span className="text-sm font-black text-foreground leading-tight">{label}</span>
                              <span className="text-[10px] text-muted-foreground leading-tight">{sub}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* تفاصيل الطريقة */}
                      <AnimatePresence mode="wait">
                        <motion.div key={paymentMethod} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.14 }}>
                          <div
                            className="rounded-2xl p-4 space-y-3"
                            style={{ background: "hsl(var(--muted)/0.6)", border: "1px solid hsl(var(--border))" }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">المبلغ المطلوب</span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-muted-foreground line-through opacity-60">1000 دج</span>
                                <span className="text-sm font-black" style={{ color: "#22c55e" }}>500 دج</span>
                              </div>
                            </div>
                            <div className="h-px" style={{ background: "hsl(var(--border))" }} />
                            <div className="space-y-1.5">
                              <span className="text-xs text-muted-foreground">
                                رقم RIP — انقر للنسخ
                              </span>
                              <RIPCopyField rip="00799999002789880450" />
                            </div>
                          </div>

                          {paymentMethod === "ccp" && (
                            <div
                              className="mt-2.5 rounded-xl px-3.5 py-2.5 flex gap-2.5 items-start"
                              style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}
                            >
                              <span className="text-base mt-0.5">🤖</span>
                              <p className="text-xs leading-relaxed" style={{ color: "#818cf8" }}>
                                بعد الدفع، ارفع صورة تأكيد العملية وسيتحقق الذكاء الاصطناعي منها تلقائياً خلال ثوانٍ
                              </p>
                            </div>
                          )}
                        </motion.div>
                      </AnimatePresence>

                      <button
                        onClick={() => setPayStep(2)}
                        className="w-full flex items-center justify-center gap-2 font-black text-sm rounded-2xl py-3.5 text-white transition-all active:scale-[0.98]"
                        style={{
                          background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
                          boxShadow: "0 4px 18px rgba(99,102,241,0.40)",
                        }}
                      >
                        دفعت؟ ارفع الوصل <ArrowLeft className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {/* ════ الخطوة 2 ════ */}
                  {payStep === 2 && (
                    <motion.div key="s2" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.18 }} className="space-y-3">

                      {uploaded ? (
                        /* ── نجاح ── */
                        <motion.div
                          initial={{ scale: 0.85, opacity: 0 }}
                          animate={{ scale: 1, opacity: 1 }}
                          transition={{ type: "spring", stiffness: 280, damping: 22 }}
                          className="flex flex-col items-center gap-4 py-4"
                        >
                          <div
                            className="w-20 h-20 rounded-full flex items-center justify-center"
                            style={{
                              background: "radial-gradient(circle, rgba(34,197,94,0.15) 0%, rgba(34,197,94,0.05) 100%)",
                              border: "2.5px solid rgba(34,197,94,0.5)",
                              boxShadow: "0 0 30px rgba(34,197,94,0.20)",
                            }}
                          >
                            <CheckCircle2 className="w-10 h-10" style={{ color: "#22c55e" }} />
                          </div>
                          <div className="text-center space-y-1">
                            <p className="text-xl font-black text-foreground">مبروك! 🎉</p>
                            <p className="text-sm text-muted-foreground">حسابك مُفعَّل — تصحيحات غير محدودة</p>
                          </div>
                          <button
                            onClick={() => { setShowPayment(false); setPayStep(1); setUploaded(false); setPaymentMethod("baridimob"); setLocation("/"); }}
                            className="w-full flex items-center justify-center gap-2 font-black text-sm rounded-2xl py-3.5 text-white transition-all active:scale-[0.98]"
                            style={{
                              background: "linear-gradient(135deg, #16a34a, #22c55e)",
                              boxShadow: "0 4px 18px rgba(34,197,94,0.35)",
                            }}
                          >
                            <Zap className="w-4 h-4" /> انطلق للتطبيق
                          </button>
                        </motion.div>
                      ) : ccpVerifying ? (
                        /* ── تحليل AI ── */
                        <motion.div
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="flex flex-col items-center gap-4 py-6"
                        >
                          <div className="relative w-20 h-20">
                            {/* حلقة خارجية دوّارة */}
                            <div
                              className="absolute inset-0 rounded-full animate-spin"
                              style={{ border: "2.5px solid transparent", borderTopColor: "#6366f1", borderRightColor: "#8b5cf6" }}
                            />
                            {/* حلقة داخلية عكسية */}
                            <div
                              className="absolute inset-2 rounded-full animate-spin"
                              style={{ border: "2px solid transparent", borderTopColor: "#a78bfa", animationDirection: "reverse", animationDuration: "0.8s" }}
                            />
                            <div
                              className="absolute inset-0 flex items-center justify-center rounded-full"
                              style={{ background: "rgba(99,102,241,0.08)" }}
                            >
                              <span className="text-2xl">🤖</span>
                            </div>
                          </div>
                          <div className="text-center space-y-1">
                            <p className="text-base font-black text-foreground">جاري تحليل الوصل</p>
                            <p className="text-xs text-muted-foreground">الذكاء الاصطناعي يتحقق من وصل CCP...</p>
                          </div>
                          {/* نقاط متحركة */}
                          <div className="flex gap-1.5">
                            {[0, 1, 2].map((i) => (
                              <motion.div
                                key={i}
                                className="w-2 h-2 rounded-full"
                                style={{ background: "#6366f1" }}
                                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.2, 0.8] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                              />
                            ))}
                          </div>
                        </motion.div>
                      ) : (
                        /* ── رفع الوصل ── */
                        <>
                          <label
                            className="group relative flex flex-col items-center gap-3 rounded-2xl p-6 cursor-pointer transition-all duration-200"
                            style={{
                              border: "2px dashed hsl(var(--border))",
                              background: "hsl(var(--muted)/0.3)",
                            }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#6366f1"; (e.currentTarget as HTMLElement).style.background = "rgba(99,102,241,0.04)"; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "hsl(var(--border))"; (e.currentTarget as HTMLElement).style.background = "hsl(var(--muted)/0.3)"; }}
                          >
                            <input type="file" className="hidden" onChange={handleUpload} disabled={isUploading} />

                            {isUploading ? (
                              <div className="flex flex-col items-center gap-2 py-2">
                                <div className="w-10 h-10 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                                <span className="text-sm font-semibold text-primary">جاري الرفع...</span>
                              </div>
                            ) : (
                              <>
                                <div
                                  className="w-14 h-14 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110"
                                  style={{
                                    background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.10))",
                                    border: "1.5px solid rgba(99,102,241,0.25)",
                                  }}
                                >
                                  <Upload className="w-6 h-6" style={{ color: "#6366f1" }} />
                                </div>
                                <div className="text-center">
                                  <p className="text-sm font-bold text-foreground">اختر صورة الوصل</p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {paymentMethod === "ccp"
                                      ? "الذكاء الاصطناعي سيتحقق منها تلقائياً 🔍"
                                      : "JPG أو PNG — التفعيل فوري ✨"}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
                                  <div className="h-px w-8 bg-border" />
                                  <span>أو اسحب الصورة هنا</span>
                                  <div className="h-px w-8 bg-border" />
                                </div>
                              </>
                            )}
                          </label>

                          <button
                            onClick={() => setPayStep(1)}
                            className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground font-semibold transition-colors py-1"
                          >
                            <ArrowLeft className="w-3.5 h-3.5 rotate-180" />
                            العودة لاختيار طريقة الدفع
                          </button>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
