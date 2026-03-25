import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogIn, ShieldCheck, CreditCard, Upload, Moon, Sun,
  CheckCircle2, Copy, Check, ArrowLeft, UserPlus, Eye, EyeOff, User, Phone, Lock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import AppLogo from "@/components/AppLogo";

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
      <span className="font-mono text-sm text-foreground tracking-wide select-all">
        {rip}
      </span>
      <span className="shrink-0 text-muted-foreground group-hover:text-primary transition-colors">
        {copied
          ? <Check className="w-4 h-4 text-green-500" />
          : <Copy className="w-4 h-4" />
        }
      </span>
    </button>
  );
}

function InputField({
  icon: Icon,
  label,
  type = "text",
  value,
  onChange,
  placeholder,
  disabled,
  showToggle,
}: {
  icon: React.ElementType;
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  showToggle?: boolean;
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
  const [tab, setTab] = useState<"login" | "register" | "activate">("login");
  const [activateStep, setActivateStep] = useState<1 | 2>(1);
  const [isUploading, setIsUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [regUsername, setRegUsername] = useState("");
  const [regPhone, setRegPhone] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");

  const { login } = useAuth();
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
        body: JSON.stringify({ username: loginUsername.trim(), password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "فشل الدخول", description: data.error ?? "خطأ غير معروف", variant: "destructive" });
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

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setIsUploading(true);
      setTimeout(() => {
        setIsUploading(false);
        setUploaded(true);
        toast({ title: "تم استقبال الوصل!", description: "سيتم تفعيل حسابك خلال دقائق." });
      }, 1800);
    }
  };

  const resetActivate = () => {
    setActivateStep(1);
    setUploaded(false);
  };

  const TABS = [
    { key: "login" as const, label: "دخول", icon: LogIn },
    { key: "register" as const, label: "تسجيل", icon: UserPlus },
    { key: "activate" as const, label: "تفعيل", icon: ShieldCheck },
  ];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="w-full max-w-sm relative"
      >
        <div className="bg-card border border-border rounded-3xl shadow-xl shadow-black/8 overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-8 pb-6 text-center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 20 }}
              className="inline-flex mb-4"
            >
              <AppLogo size={60} />
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <h1 className="text-xl font-black text-foreground tracking-tight mb-0.5">أستاذ الرياضيات</h1>
              <p className="text-xs text-primary/70 leading-relaxed">مصحح رياضيات الباك بالمنهجية الجزائرية 2026</p>
            </motion.div>
          </div>

          <div className="h-px bg-border mx-6" />

          {/* Tabs */}
          <div className="px-6 pt-5">
            <div className="flex bg-muted rounded-xl p-1 gap-1">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => { setTab(key); if (key === "activate") resetActivate(); }}
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

          {/* Content */}
          <div className="px-6 pt-4 pb-6">
            <AnimatePresence mode="wait">

              {/* LOGIN TAB */}
              {tab === "login" && (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-3"
                >
                  <InputField
                    icon={User}
                    label="اسم المستخدم"
                    value={loginUsername}
                    onChange={setLoginUsername}
                    placeholder="أدخل اسم المستخدم"
                    disabled={loading}
                  />
                  <InputField
                    icon={Lock}
                    label="كلمة السر"
                    value={loginPassword}
                    onChange={setLoginPassword}
                    placeholder="أدخل كلمة السر"
                    disabled={loading}
                    showToggle
                  />
                  <button
                    onClick={handleLogin}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-3 px-5 transition-all duration-200 shadow-sm shadow-primary/20 hover:shadow-md hover:shadow-primary/25 hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed mt-1"
                  >
                    {loading
                      ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      : <LogIn className="w-4 h-4" />
                    }
                    {loading ? "جاري الدخول..." : "دخول"}
                  </button>
                  <p className="text-center text-xs text-muted-foreground pt-1">
                    ليس لديك حساب؟{" "}
                    <button onClick={() => setTab("register")} className="text-primary font-bold hover:underline">
                      سجّل الآن
                    </button>
                  </p>
                </motion.div>
              )}

              {/* REGISTER TAB */}
              {tab === "register" && (
                <motion.div
                  key="register"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-3"
                >
                  <InputField
                    icon={User}
                    label="اسم المستخدم"
                    value={regUsername}
                    onChange={setRegUsername}
                    placeholder="اختر اسم مستخدم (3 أحرف +)"
                    disabled={loading}
                  />
                  <InputField
                    icon={Phone}
                    label="رقم الهاتف"
                    value={regPhone}
                    onChange={setRegPhone}
                    placeholder="05XXXXXXXX"
                    disabled={loading}
                  />
                  <InputField
                    icon={Lock}
                    label="كلمة السر"
                    value={regPassword}
                    onChange={setRegPassword}
                    placeholder="6 أحرف على الأقل"
                    disabled={loading}
                    showToggle
                  />
                  <InputField
                    icon={Lock}
                    label="تأكيد كلمة السر"
                    value={regConfirm}
                    onChange={setRegConfirm}
                    placeholder="أعد إدخال كلمة السر"
                    disabled={loading}
                    showToggle
                  />
                  <button
                    onClick={handleRegister}
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-3 px-5 transition-all duration-200 shadow-sm shadow-primary/20 hover:shadow-md hover:-translate-y-px active:translate-y-0 disabled:opacity-60 disabled:cursor-not-allowed mt-1"
                  >
                    {loading
                      ? <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      : <UserPlus className="w-4 h-4" />
                    }
                    {loading ? "جاري التسجيل..." : "إنشاء الحساب"}
                  </button>
                  <p className="text-center text-xs text-muted-foreground pt-1">
                    لديك حساب؟{" "}
                    <button onClick={() => setTab("login")} className="text-primary font-bold hover:underline">
                      ادخل هنا
                    </button>
                  </p>
                </motion.div>
              )}

              {/* ACTIVATE TAB */}
              {tab === "activate" && (
                <motion.div
                  key="activate"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  transition={{ duration: 0.18 }}
                  className="space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-black transition-all ${activateStep === 1 ? "bg-primary text-primary-foreground" : "bg-green-500 text-white"}`}>
                      {activateStep > 1 ? <Check className="w-3.5 h-3.5" /> : "1"}
                    </div>
                    <div className="flex-1 h-px bg-border" />
                    <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-black transition-all ${activateStep === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                      2
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    {activateStep === 1 && (
                      <motion.div
                        key="step1"
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        transition={{ duration: 0.15 }}
                        className="space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-4 h-4 text-primary" />
                          <span className="text-sm font-bold text-foreground">أرسل رسوم التفعيل</span>
                        </div>
                        <div className="bg-muted/50 rounded-2xl p-3.5 space-y-2.5">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-muted-foreground">المبلغ</span>
                            <div className="text-left flex flex-col items-end gap-0.5">
                              <span className="text-xs text-muted-foreground line-through">1000 دج</span>
                              <span className="text-base font-black" style={{ color: "#16a34a" }}>500 دج</span>
                            </div>
                          </div>
                          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300/60 rounded-xl px-3 py-2 text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
                            ادفع <strong>500 دج</strong> الآن واحصل على <strong>(نسخة الطالب المتميز)</strong> ✨
                          </div>
                          <div className="h-px bg-border" />
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-muted-foreground">الطريقة</span>
                            <span className="text-sm font-bold text-foreground">بريدي موب</span>
                          </div>
                          <div className="h-px bg-border" />
                          <div className="space-y-1.5">
                            <span className="text-xs text-muted-foreground">رقم RIP</span>
                            <RIPCopyField rip="00799999002789880450" />
                          </div>
                        </div>
                        <button
                          onClick={() => setActivateStep(2)}
                          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-3 transition-all duration-200 shadow-sm shadow-primary/20 hover:shadow-md hover:-translate-y-px active:translate-y-0"
                        >
                          دفعت؟ ارفع الوصل
                          <ArrowLeft className="w-4 h-4" />
                        </button>
                      </motion.div>
                    )}

                    {activateStep === 2 && (
                      <motion.div
                        key="step2"
                        initial={{ opacity: 0, x: 8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        transition={{ duration: 0.15 }}
                        className="space-y-3"
                      >
                        <div className="flex items-center gap-2">
                          <Upload className="w-4 h-4 text-primary" />
                          <span className="text-sm font-bold text-foreground">ارفع صورة الوصل</span>
                        </div>
                        {uploaded ? (
                          <div className="flex flex-col items-center gap-3 py-6">
                            <div className="w-12 h-12 rounded-full border-2 flex items-center justify-center" style={{ background: "rgba(34,197,94,0.1)", borderColor: "rgba(34,197,94,0.35)" }}>
                              <CheckCircle2 className="w-6 h-6" style={{ color: "#22c55e" }} />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-bold text-foreground mb-0.5">تم استقبال الوصل!</p>
                              <p className="text-xs text-muted-foreground">سيتم تفعيل حسابك خلال دقائق</p>
                            </div>
                            <button onClick={() => setTab("login")} className="text-xs text-primary font-bold hover:underline">
                              الذهاب إلى الدخول
                            </button>
                          </div>
                        ) : (
                          <>
                            <label className={`flex flex-col items-center gap-2.5 border-2 border-dashed rounded-2xl p-5 cursor-pointer transition-all duration-200 ${isUploading ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-primary/4"}`}>
                              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={isUploading} />
                              {isUploading ? (
                                <>
                                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                  <span className="text-sm font-semibold text-primary">جاري الرفع...</span>
                                </>
                              ) : (
                                <>
                                  <div className="w-10 h-10 rounded-full bg-primary/8 border border-primary/20 flex items-center justify-center">
                                    <Upload className="w-4 h-4 text-primary" />
                                  </div>
                                  <div className="text-center">
                                    <p className="text-sm font-semibold text-foreground">اختر صورة الوصل</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG · التفعيل فوري</p>
                                  </div>
                                </>
                              )}
                            </label>
                            <button onClick={() => setActivateStep(1)} className="w-full text-xs text-muted-foreground hover:text-foreground font-medium transition-colors">
                              ← رجوع للخطوة السابقة
                            </button>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}

            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">© منصة حل عقدة الباك 2026</p>
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
    </div>
  );
}
