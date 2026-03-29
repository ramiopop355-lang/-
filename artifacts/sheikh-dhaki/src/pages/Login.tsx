import { useState } from "react";
import { useAuth, getDeviceId, getDeviceName } from "@/context/AuthContext";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogIn, ShieldCheck, Moon, Sun,
  Check, Copy, ArrowLeft, UserPlus, Eye, EyeOff, User, Phone, Lock,
  Sparkles, Gift, Upload, CheckCircle2, Zap
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

function useDarkModeToggle() {
  const getInitial = () => {
    const stored = localStorage.getItem("dhaki-dark");
    if (stored !== null) return stored === "true";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  };
  const [isDark, setIsDark] = useState(() => {
    const d = getInitial();
    document.documentElement.classList.toggle("dark", d);
    return d;
  });
  const toggle = () => {
    setIsDark((prev) => {
      const next = !prev;
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("dhaki-dark", String(next));
      return next;
    });
  };
  return { isDark, toggle };
}

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

  const { login, token: authToken, updateUser, user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isDark, toggle } = useDarkModeToggle();

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
        if (data.code === "DEVICE_LIMIT_REACHED") {
          toast({ title: "حد الأجهزة", description: data.error, variant: "destructive", duration: 6000 });
        } else {
          toast({ title: "فشل الدخول", description: data.error ?? "خطأ غير معروف", variant: "destructive" });
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
      // بريدي موب — تفعيل فوري بدون انتظار
      setUploaded(true);
      if (user) updateUser(authToken, { ...user, activated: true });
      toast({ title: "🎉 تم تفعيل حسابك!", description: "مبروك! يمكنك الآن الاستخدام غير المحدود." });
      setIsUploading(true);
      try {
        const res = await fetch("/api/auth/activate", {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}` },
          body: form,
        });
        const data = await res.json();
        if (res.ok) updateUser(data.token, data.user);
      } catch {
        // التفعيل المحلي مؤكد — الخادم سيُزامن لاحقاً
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
        } else if (data.code === "INVALID_CCP_RECEIPT") {
          toast({
            title: "الوصل غير صالح",
            description: data.reason ?? "تأكد أن الصورة هي وصل تأكيد دفع CCP حقيقي من بريد الجزائر.",
            variant: "destructive",
            duration: 7000,
          });
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
                <p className="text-xs text-muted-foreground">منهجية وزارة التربية الجزائرية · بكالوريا 2026</p>
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
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
                <span className="text-xs font-black text-white" style={{ fontFamily: "serif" }}>Σ</span>
              </div>
              <p className="text-xs text-muted-foreground">سِيغْمَا © 2026 — جميع الحقوق محفوظة</p>
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

      {/* Payment Modal */}
      <AnimatePresence>
        {showPayment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowPayment(false); setPayStep(1); setUploaded(false); setPaymentMethod("baridimob"); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
              className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              {/* Modal Header */}
              <div className="px-6 pt-5 pb-4 flex items-center justify-between border-b border-border">
                <div>
                  <h3 className="text-base font-black text-foreground">تفعيل النسخة الكاملة</h3>
                  <p className="text-xs text-muted-foreground">عرض سنوي — وفّر 50٪</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-left">
                    <span className="text-xs text-muted-foreground line-through block">1000 دج</span>
                    <span className="text-lg font-black" style={{ color: "#6366f1" }}>500 دج</span>
                  </div>
                  <button
                    onClick={() => { setShowPayment(false); setPayStep(1); setUploaded(false); setPaymentMethod("baridimob"); }}
                    className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-4">
                {/* Steps */}
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black transition-all ${payStep === 1 ? "bg-primary text-primary-foreground" : "bg-green-500 text-white"}`}>
                    {payStep > 1 ? <Check className="w-3.5 h-3.5" /> : "1"}
                  </div>
                  <div className="flex-1 h-px bg-border" />
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-black transition-all ${payStep === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    2
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {payStep === 1 && (
                    <motion.div key="pay1" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="space-y-3">

                      {/* ── اختيار طريقة الدفع ── */}
                      <div className="grid grid-cols-2 gap-2">
                        {(["baridimob", "ccp"] as const).map((method) => {
                          const isSel = paymentMethod === method;
                          const label = method === "baridimob" ? "بريدي موب" : "CCP بريد الجزائر";
                          const icon  = method === "baridimob" ? "📱" : "🏦";
                          return (
                            <button
                              key={method}
                              onClick={() => setPaymentMethod(method)}
                              className="flex flex-col items-center gap-1 rounded-xl py-2.5 px-2 border-2 transition-all text-center"
                              style={{
                                borderColor: isSel ? "#6366f1" : "hsl(var(--border))",
                                background:  isSel ? "rgba(99,102,241,0.10)" : "hsl(var(--muted)/0.4)",
                                boxShadow:   isSel ? "0 0 0 3px rgba(99,102,241,0.15)" : "none",
                              }}
                            >
                              <span className="text-lg leading-none">{icon}</span>
                              <span className="text-xs font-bold" style={{ color: isSel ? "#6366f1" : "hsl(var(--muted-foreground))" }}>{label}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* ── تفاصيل الطريقة ── */}
                      <AnimatePresence mode="wait">
                        <motion.div key={paymentMethod} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
                          <div className="bg-muted/50 rounded-2xl p-3.5 space-y-2.5">
                            <div className="flex justify-between items-center">
                              <span className="text-xs text-muted-foreground">المبلغ</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-muted-foreground line-through">1000 دج</span>
                                <span className="text-base font-black" style={{ color: "#16a34a" }}>500 دج</span>
                              </div>
                            </div>
                            <div className="h-px bg-border" />
                            {paymentMethod === "baridimob" ? (
                              <div className="space-y-1.5">
                                <span className="text-xs text-muted-foreground">رقم RIP — انقر للنسخ</span>
                                <RIPCopyField rip="00799999002789880450" />
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                <span className="text-xs text-muted-foreground">رقم CCP — انقر للنسخ</span>
                                {/* ⚠ غيّر هذا الرقم برقم CCP الحقيقي */}
                                <RIPCopyField rip="1234567890 / clé 89" />
                              </div>
                            )}
                          </div>
                          <div className="mt-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-300/60 rounded-xl px-3 py-2 text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
                            {paymentMethod === "baridimob"
                              ? <>ادفع <strong>500 دج</strong> عبر بريدي موب على الرقم أعلاه، ثم ارفع وصل الدفع ✨</>
                              : <>حوّل <strong>500 دج</strong> على رقم CCP أعلاه عبر البريد أو BaridiNet، ثم ارفع صورة تأكيد العملية 🏦 — سيتحقق الذكاء الاصطناعي من وصلك تلقائياً</>
                            }
                          </div>
                        </motion.div>
                      </AnimatePresence>

                      <button
                        onClick={() => setPayStep(2)}
                        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-2.5 transition-all shadow-sm hover:-translate-y-px"
                      >
                        دفعت؟ ارفع الوصل <ArrowLeft className="w-4 h-4" />
                      </button>
                    </motion.div>
                  )}

                  {payStep === 2 && (
                    <motion.div key="pay2" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="space-y-3">
                      {uploaded ? (
                        <div className="flex flex-col items-center gap-3 py-6">
                          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.12)", border: "2px solid rgba(34,197,94,0.4)" }}>
                            <CheckCircle2 className="w-7 h-7" style={{ color: "#22c55e" }} />
                          </div>
                          <div className="text-center">
                            <p className="text-base font-black text-foreground mb-0.5">🎉 تم تفعيل حسابك!</p>
                            <p className="text-xs text-muted-foreground">يمكنك الآن الاستخدام غير المحدود</p>
                          </div>
                          <button
                            onClick={() => { setShowPayment(false); setPayStep(1); setUploaded(false); setPaymentMethod("baridimob"); setLocation("/"); }}
                            className="w-full flex items-center justify-center gap-2 font-bold text-sm rounded-xl py-2.5 text-white transition-all hover:-translate-y-px"
                            style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)", boxShadow: "0 4px 12px rgba(34,197,94,0.3)" }}
                          >
                            <Zap className="w-4 h-4" /> انطلق للتطبيق
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* حالة تحليل الـ CCP */}
                          {ccpVerifying && (
                            <div className="flex flex-col items-center gap-2.5 py-3">
                              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(99,102,241,0.12)", border: "2px solid rgba(99,102,241,0.3)" }}>
                                <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              </div>
                              <div className="text-center">
                                <p className="text-sm font-bold text-foreground">جاري تحليل الوصل...</p>
                                <p className="text-xs text-muted-foreground mt-0.5">الذكاء الاصطناعي يتحقق من وصل CCP</p>
                              </div>
                            </div>
                          )}
                          <label className={`flex flex-col items-center gap-2.5 border-2 border-dashed rounded-2xl p-5 cursor-pointer transition-all ${isUploading ? "border-primary/40 bg-primary/5 pointer-events-none" : "border-border hover:border-primary/50 hover:bg-primary/4"}`}>
                            <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={isUploading} />
                            {isUploading && !ccpVerifying ? (
                              <>
                                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <span className="text-sm font-semibold text-primary">جاري الرفع...</span>
                              </>
                            ) : !isUploading ? (
                              <>
                                <div className="w-10 h-10 rounded-full bg-primary/8 border border-primary/20 flex items-center justify-center">
                                  <Upload className="w-4 h-4 text-primary" />
                                </div>
                                <div className="text-center">
                                  <p className="text-sm font-semibold text-foreground">اختر صورة الوصل</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">
                                    {paymentMethod === "ccp"
                                      ? "JPG, PNG · سيتحقق الذكاء الاصطناعي من الوصل 🔍"
                                      : "JPG, PNG · التفعيل فوري ✨"}
                                  </p>
                                </div>
                              </>
                            ) : null}
                          </label>
                          <button onClick={() => setPayStep(1)} className="w-full text-xs text-muted-foreground hover:text-foreground font-medium transition-colors">
                            → رجوع للخطوة السابقة
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
