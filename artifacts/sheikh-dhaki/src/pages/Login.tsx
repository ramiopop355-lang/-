import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogIn, ShieldCheck, CreditCard, Upload, Moon, Sun,
  CheckCircle2, Copy, Check, ArrowLeft, Calculator
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
      className="w-full flex items-center justify-between gap-3 bg-muted border border-border hover:border-primary/50 rounded-xl px-4 py-3 transition-all group"
    >
      <span className="font-mono text-sm text-foreground tracking-wider select-all">
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

export default function Login() {
  const [tab, setTab] = useState<"login" | "activate">("login");
  const [activateStep, setActivateStep] = useState<1 | 2>(1);
  const [isUploading, setIsUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { isDark, toggle } = useDarkModeToggle();

  const handleLogin = () => {
    login();
    toast({ title: "مرحباً بك!", description: "الباك راهو في الجيب، خلينا نبدأ." });
    setLocation("/");
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

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">

      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full bg-primary/8 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-72 h-72 rounded-full bg-accent/6 blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-primary/3 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="w-full max-w-sm relative"
      >
        {/* Card */}
        <div className="bg-card border border-border rounded-3xl shadow-2xl shadow-black/10 overflow-hidden">

          {/* Top accent bar */}
          <div className="h-1 bg-gradient-to-l from-primary via-primary/80 to-accent" />

          {/* Header */}
          <div className="px-8 pt-7 pb-5 text-center">
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.12, type: "spring", stiffness: 280, damping: 22 }}
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4"
            >
              <Calculator className="w-7 h-7 text-primary" />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <h1 className="text-xl font-black text-foreground tracking-tight mb-1">
                الشيخ الذكي
              </h1>
              <p className="text-xs text-muted-foreground leading-relaxed">
                مقيّم الرياضيات — بكالوريا الجزائر 2026
              </p>
            </motion.div>
          </div>

          {/* Divider */}
          <div className="h-px bg-border mx-6" />

          {/* Tabs */}
          <div className="px-6 pt-5">
            <div className="flex bg-muted rounded-xl p-1 gap-1 border border-border/60">
              {(["login", "activate"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTab(t); resetActivate(); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
                    tab === t
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "login"
                    ? <><LogIn className="w-3.5 h-3.5" /> دخول</>
                    : <><ShieldCheck className="w-3.5 h-3.5" /> تفعيل</>
                  }
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
                  className="space-y-4"
                >
                  <div className="flex items-start gap-3 bg-primary/6 border border-primary/20 rounded-2xl p-3.5">
                    <CheckCircle2 className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <p className="text-xs text-foreground/80 leading-relaxed">
                      إذا كان حسابك مفعلاً، اضغط على الزر للدخول مباشرة.
                    </p>
                  </div>

                  <button
                    onClick={handleLogin}
                    className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-3.5 px-5 transition-all duration-200 shadow-md shadow-primary/25 hover:shadow-lg hover:shadow-primary/30 hover:-translate-y-px active:translate-y-0"
                  >
                    <LogIn className="w-4 h-4" />
                    ⚡ استمتع بالفترة المجانية مؤقتاً
                  </button>

                  <p className="text-center text-xs text-muted-foreground">
                    ليس لديك حساب؟{" "}
                    <button
                      onClick={() => setTab("activate")}
                      className="text-primary font-bold hover:underline"
                    >
                      فعّل حسابك
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
                  {/* Steps indicator */}
                  <div className="flex items-center gap-2 px-1">
                    <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-black border-2 transition-all ${activateStep === 1 ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30" : "bg-green-500 border-green-500 text-white"}`}>
                      {activateStep > 1 ? <Check className="w-3.5 h-3.5" /> : "1"}
                    </div>
                    <div className="flex-1 h-0.5 bg-border rounded-full overflow-hidden">
                      <div className={`h-full bg-primary transition-all duration-500 ${activateStep > 1 ? "w-full" : "w-0"}`} />
                    </div>
                    <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-black border-2 transition-all ${activateStep === 2 ? "bg-primary border-primary text-primary-foreground shadow-sm shadow-primary/30" : "bg-muted border-border text-muted-foreground"}`}>
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
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                            <CreditCard className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <span className="text-sm font-bold text-foreground">أرسل رسوم التفعيل</span>
                        </div>

                        <div className="bg-muted/60 border border-border rounded-2xl p-3.5 space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-muted-foreground">المبلغ</span>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground line-through">1000 دج</span>
                              <span className="text-base font-black text-green-600 dark:text-green-400">500 دج</span>
                            </div>
                          </div>
                          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-xl px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
                            ادفع <strong>500 دج</strong> الآن واحصل على <strong>نسخة الطالب المتميز</strong> مع ميزات حصرية مستقبلاً ✨
                          </div>
                          <div className="h-px bg-border" />
                          <div className="flex justify-between items-center">
                            <span className="text-xs text-muted-foreground">الطريقة</span>
                            <span className="text-sm font-bold text-foreground">بريدي موب</span>
                          </div>
                          <div className="h-px bg-border" />
                          <div className="space-y-1.5">
                            <span className="text-xs text-muted-foreground block">رقم RIP</span>
                            <RIPCopyField rip="00799999002789880450" />
                          </div>
                        </div>

                        <button
                          onClick={() => setActivateStep(2)}
                          className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-3.5 transition-all duration-200 shadow-md shadow-primary/20 hover:shadow-lg hover:-translate-y-px active:translate-y-0"
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
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Upload className="w-3.5 h-3.5 text-primary" />
                          </div>
                          <span className="text-sm font-bold text-foreground">ارفع صورة الوصل</span>
                        </div>

                        {uploaded ? (
                          <div className="flex flex-col items-center gap-3 py-6">
                            <div className="w-14 h-14 rounded-2xl bg-green-500/10 border-2 border-green-500/30 flex items-center justify-center">
                              <CheckCircle2 className="w-7 h-7 text-green-500" />
                            </div>
                            <div className="text-center">
                              <p className="text-sm font-bold text-foreground mb-0.5">تم استقبال الوصل!</p>
                              <p className="text-xs text-muted-foreground">سيتم تفعيل حسابك خلال دقائق</p>
                            </div>
                            <button
                              onClick={() => setTab("login")}
                              className="text-xs text-primary font-bold hover:underline"
                            >
                              الذهاب إلى الدخول
                            </button>
                          </div>
                        ) : (
                          <>
                            <label className={`flex flex-col items-center gap-3 border-2 border-dashed rounded-2xl p-5 cursor-pointer transition-all duration-200 ${isUploading ? "border-primary bg-primary/5" : "border-border hover:border-primary/60 hover:bg-primary/3"}`}>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={handleUpload}
                                disabled={isUploading}
                              />
                              {isUploading ? (
                                <>
                                  <div className="w-9 h-9 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                  <span className="text-sm font-semibold text-primary">جاري الرفع...</span>
                                </>
                              ) : (
                                <>
                                  <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                    <Upload className="w-5 h-5 text-primary" />
                                  </div>
                                  <div className="text-center">
                                    <p className="text-sm font-semibold text-foreground">اختر صورة الوصل</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG · التفعيل فوري</p>
                                  </div>
                                </>
                              )}
                            </label>

                            <button
                              onClick={() => setActivateStep(1)}
                              className="w-full text-xs text-muted-foreground hover:text-foreground font-medium transition-colors"
                            >
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
          <div className="border-t border-border bg-muted/30 px-6 py-3 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              © منصة حل عقدة الباك 2026
            </p>
            <button
              onClick={toggle}
              className="w-7 h-7 rounded-full border border-border bg-card flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition-all"
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
