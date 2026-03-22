import { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  GraduationCap, ShieldCheck, UserCircle, Rocket, CreditCard, Upload, Moon, Sun
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

export default function Login() {
  const [tab, setTab] = useState<"login" | "activate">("login");
  const [isUploading, setIsUploading] = useState(false);
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
        toast({ title: "تم استقبال الوصل!", description: "حسابك مفعل الآن. يمكنك الدخول." });
        setTab("login");
      }, 1500);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <div className="bg-card border border-border rounded-3xl p-8 shadow-xl shadow-primary/5">
          {/* Logo */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.15, type: "spring", stiffness: 220 }}
            className="w-16 h-16 mx-auto bg-gradient-to-br from-primary to-accent rounded-2xl flex items-center justify-center shadow-lg shadow-primary/25 mb-5"
          >
            <GraduationCap className="w-8 h-8 text-primary-foreground" />
          </motion.div>

          {/* Title */}
          <h1 className="text-2xl font-black text-foreground text-center mb-1">
            الأستاذ المصحح
          </h1>
          <p className="text-sm text-muted-foreground text-center mb-5">
            مختبر تصحيح تمارين البكالوريا بالمنهجية الجزائرية
          </p>

          {/* Badge */}
          <div className="flex justify-center mb-5">
            <span className="inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-bold px-4 py-1.5 rounded-full shadow shadow-primary/30">
              اشتراك التفعيل: 1000 دج
            </span>
          </div>

          <div className="h-px bg-border mb-5" />

          {/* Tabs */}
          <div className="flex gap-1.5 bg-muted p-1 rounded-xl mb-5">
            {(["login", "activate"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all duration-200 ${
                  tab === t
                    ? "bg-primary text-primary-foreground shadow shadow-primary/30"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "login"
                  ? <><UserCircle className="w-4 h-4" /> دخول الطالب</>
                  : <><ShieldCheck className="w-4 h-4" /> تفعيل الحساب</>
                }
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="min-h-[140px]">
            <AnimatePresence mode="wait">
              {tab === "login" ? (
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.2 }}
                >
                  <button
                    onClick={handleLogin}
                    className="w-full flex items-center justify-center gap-2.5 bg-gradient-to-l from-primary to-accent text-primary-foreground font-black text-base rounded-xl py-3.5 px-6 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 transition-all duration-200"
                  >
                    الدخول إلى مختبر التصحيح
                    <Rocket className="w-5 h-5" />
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="activate"
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-2 text-sm font-bold text-primary">
                    <CreditCard className="w-4 h-4" />
                    أرسل مبلغ 1000 دج عبر بريدي موب
                  </div>

                  <div className="bg-muted border border-border rounded-xl py-2.5 px-4 text-center font-mono text-sm select-all text-foreground">
                    RIP: 00799999002789880450
                  </div>

                  <label className="flex flex-col items-center gap-2 border-2 border-dashed border-primary/30 hover:border-primary bg-primary/5 hover:bg-primary/8 transition-colors rounded-xl p-5 cursor-pointer">
                    <input type="file" accept="image/*" className="hidden" onChange={handleUpload} disabled={isUploading} />
                    {isUploading ? (
                      <>
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-medium text-primary">جاري التحقق...</span>
                      </>
                    ) : (
                      <>
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                          <Upload className="w-4 h-4 text-primary" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">ارفع صورة الوصل</span>
                        <span className="text-xs text-muted-foreground">التفعيل فوري · JPG, PNG</span>
                      </>
                    )}
                  </label>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-muted-foreground mt-5">
            حقوق الطبع والنشر محفوظة © منصة حل عقدة الباك 2026
          </p>
        </div>
      </motion.div>

      {/* Dark Mode Toggle */}
      <button
        onClick={toggle}
        title={isDark ? "الوضع النهاري" : "الوضع الليلي"}
        className="fixed bottom-5 left-5 w-10 h-10 rounded-full bg-card border border-border flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 shadow-md transition-all duration-200 hover:scale-105"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    </div>
  );
}
