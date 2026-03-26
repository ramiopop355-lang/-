import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, CalendarDays, Upload, ChevronDown,
  Image as ImageIcon, XCircle, LogOut, MessageSquare, Moon, Sun, Copy, Check,
  FileText, PenLine, CheckCircle2, Zap, ShieldCheck
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type HistoryItem = {
  id: string;
  evaluation: string;
  shoba: string;
  date: Date;
  exercisePreview?: string;
  attemptPreview?: string;
};

const SHOBAS = ["رياضيات", "تقني رياضي", "علوم تجريبية", "تسيير واقتصاد", "آداب وفلسفة", "لغات أجنبية"];
const BAC_DATE = new Date(2026, 5, 7);
const TRIAL_MAX = 3;
const TRIAL_KEY = "ustad-trial-used";

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

function RIPCopy({ rip }: { rip: string }) {
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      title="نسخ"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

type ImageUploadZoneProps = {
  label: string;
  icon: React.ReactNode;
  hint: string;
  file: File | null;
  previewUrl: string | null;
  onFileChange: (f: File) => void;
  onClear: () => void;
};

function ImageUploadZone({ label, icon, hint, file, previewUrl, onFileChange, onClear }: ImageUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) {
      onFileChange(f);
    }
  }, [onFileChange]);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
        {icon}
        {label}
      </label>
      <input
        type="file"
        ref={inputRef}
        accept="image/*"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) onFileChange(e.target.files[0]); }}
      />
      {!previewUrl ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="w-full border-2 border-dashed border-border hover:border-primary/60 bg-muted/30 hover:bg-primary/5 transition-all rounded-xl p-4 flex flex-col items-center gap-1.5 group"
        >
          <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Upload className="w-4 h-4 text-primary" />
          </div>
          <span className="text-xs font-semibold text-foreground">اختر صورة أو اسحبها</span>
          <span className="text-xs text-muted-foreground">{hint} · JPG, PNG, WEBP</span>
        </button>
      ) : (
        <div className="relative rounded-xl overflow-hidden border border-border group">
          <img src={previewUrl} alt="Preview" className="w-full h-36 object-contain bg-muted/30" />
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="bg-primary text-primary-foreground p-2 rounded-full hover:scale-110 transition-transform shadow-lg"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClear}
              className="bg-destructive text-destructive-foreground p-2 rounded-full hover:scale-110 transition-transform shadow-lg"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="absolute bottom-0 inset-x-0 bg-background/80 text-xs text-center py-1 text-muted-foreground truncate px-2">
            {file?.name}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedShoba, setSelectedShoba] = useState(SHOBAS[0]);

  const [exerciseFile, setExerciseFile] = useState<File | null>(null);
  const [exercisePreviewUrl, setExercisePreviewUrl] = useState<string | null>(null);

  const [attemptFile, setAttemptFile] = useState<File | null>(null);
  const [attemptPreviewUrl, setAttemptPreviewUrl] = useState<string | null>(null);

  const [notes, setNotes] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [trialUsed, setTrialUsed] = useState(() => {
    return parseInt(localStorage.getItem(TRIAL_KEY) || "0", 10);
  });
  const [showPayment, setShowPayment] = useState(false);
  const [payStep, setPayStep] = useState<1 | 2>(1);
  const [isUploading, setIsUploading] = useState(false);
  const [payUploaded, setPayUploaded] = useState(false);

  const { logout, user, token: authToken, updateUser } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const boardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTextRef = useRef<string>("");
  const { isDark, toggle } = useDarkModeToggle();
  const daysLeft = Math.max(0, differenceInDays(BAC_DATE, new Date()));
  const trialRemaining = Math.max(0, TRIAL_MAX - trialUsed);
  const isActivated = user?.activated === true;
  const trialExpired = !isActivated && trialUsed >= TRIAL_MAX;

  useEffect(() => {
    return () => {
      if (exercisePreviewUrl) URL.revokeObjectURL(exercisePreviewUrl);
      if (attemptPreviewUrl) URL.revokeObjectURL(attemptPreviewUrl);
    };
  }, [exercisePreviewUrl, attemptPreviewUrl]);

  useEffect(() => {
    if (!user?.username) return;
    const isAndroid = /android/i.test(navigator.userAgent);
    if (!isAndroid || !("serviceWorker" in navigator) || !("PushManager" in window)) return;

    const base = import.meta.env.BASE_URL || "/";

    async function setupPush() {
      try {
        const keyRes = await fetch(`${base}api/push/vapid-public-key`);
        if (!keyRes.ok) return;
        const { key } = await keyRes.json() as { key: string };
        if (!key) return;

        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;

        const reg = await navigator.serviceWorker.ready;

        // اشتراك Push
        const existing = await reg.pushManager.getSubscription();
        const sub = existing ?? await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });

        const payload = { username: user!.username, subscription: sub };

        const postRes = await fetch(`${base}api/push/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).catch(() => null);

        if (!postRes?.ok) {
          // فشل الاتصال — احفظ البيانات وسجّل Background Sync
          const pending = await caches.open("sigma-pending");
          await pending.put(
            "/push-payload",
            new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } })
          );
          if ("sync" in reg) {
            await (reg as unknown as { sync: { register: (tag: string) => Promise<void> } })
              .sync.register("sigma-push-retry");
          }
        } else {
          // نجح الاتصال — احذف أي بيانات معلّقة سابقة
          const pending = await caches.open("sigma-pending");
          await pending.delete("/push-payload");
        }

        // Periodic Background Sync
        if ("periodicSync" in reg) {
          const status = await (navigator.permissions as unknown as { query: (d: object) => Promise<{ state: string }> })
            .query({ name: "periodic-background-sync" as PermissionName });
          if (status.state === "granted") {
            await (reg as unknown as { periodicSync: { register: (tag: string, opts: object) => Promise<void> } })
              .periodicSync.register("sigma-keepalive", { minInterval: 24 * 60 * 60 * 1000 });
          }
        }
      } catch {}
    }

    setupPush();
  }, [user?.username]);

  useEffect(() => {
    if (!("launchQueue" in window)) return;
    (window as unknown as {
      launchQueue: { setConsumer: (cb: (p: { files: { getFile: () => Promise<File> }[] }) => void) => void }
    }).launchQueue.setConsumer(async (launchParams) => {
      if (!launchParams.files.length) return;
      try {
        const first = await launchParams.files[0].getFile();
        setExercise(first);
        if (launchParams.files.length >= 2) {
          const second = await launchParams.files[1].getFile();
          setAttempt(second);
        }
      } catch {}
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const text  = params.get("share_text");
    const title = params.get("share_title");
    const url   = params.get("share_url");
    const combined = [title, text, url].filter(Boolean).join("\n").trim();
    if (combined) {
      setNotes(combined);
      window.history.replaceState({}, "", window.location.pathname);
    }

    // web+sigma:// protocol handler
    const sigmaAction = params.get("sigma_action");
    if (sigmaAction) {
      try {
        const actionUrl = new URL(sigmaAction);
        const host = actionUrl.hostname; // e.g. "correct", "note"
        const query = new URLSearchParams(actionUrl.search);
        if (host === "note" || host === "correct") {
          const text = query.get("text") ?? actionUrl.pathname.replace(/^\//, "");
          if (text) setNotes(decodeURIComponent(text));
        }
      } catch {}
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  const setExercise = (f: File) => {
    if (exercisePreviewUrl) URL.revokeObjectURL(exercisePreviewUrl);
    setExerciseFile(f);
    setExercisePreviewUrl(URL.createObjectURL(f));
  };
  const clearExercise = () => {
    setExerciseFile(null);
    if (exercisePreviewUrl) URL.revokeObjectURL(exercisePreviewUrl);
    setExercisePreviewUrl(null);
  };

  const setAttempt = (f: File) => {
    if (attemptPreviewUrl) URL.revokeObjectURL(attemptPreviewUrl);
    setAttemptFile(f);
    setAttemptPreviewUrl(URL.createObjectURL(f));
  };
  const clearAttempt = () => {
    setAttemptFile(null);
    if (attemptPreviewUrl) URL.revokeObjectURL(attemptPreviewUrl);
    setAttemptPreviewUrl(null);
  };

  const handleClearHistory = () => {
    if (confirm("هل أنت متأكد من مسح جميع التقييمات؟")) {
      setHistory([]);
      toast({ title: "تم مسح السبورة بنجاح" });
    }
  };

  const handleLogout = () => { logout(); setLocation("/login"); };

  const handleActivateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    setIsUploading(true);
    try {
      if (!authToken || authToken === "trial") {
        toast({ title: "سجّل الدخول أولاً", description: "أنشئ حساباً ثم افتح نافذة التفعيل", variant: "destructive" });
        return;
      }
      const res = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "فشل التفعيل", description: data.error ?? "خطأ غير معروف", variant: "destructive" });
        return;
      }
      updateUser(data.token, data.user);
      setPayUploaded(true);
      toast({ title: "🎉 تم تفعيل حسابك!", description: "مبروك! يمكنك الآن الاستخدام غير المحدود." });
    } catch {
      toast({ title: "خطأ في الاتصال", description: "تأكد من اتصالك بالإنترنت", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!isActivated && trialExpired) {
      setShowPayment(true);
      return;
    }
    if (!exerciseFile) {
      toast({ title: "ارفع صورة التمرين أولاً!", variant: "destructive" });
      return;
    }
    if (!attemptFile) {
      toast({ title: "ارفع صورة محاولتك أولاً!", variant: "destructive" });
      return;
    }

    setIsPending(true);
    setStreamingText("");

    const savedExercisePreview = exerciseFile ? URL.createObjectURL(exerciseFile) : null;
    const savedAttemptPreview = attemptFile ? URL.createObjectURL(attemptFile) : null;

    try {
      const formData = new FormData();
      formData.append("exercise", exerciseFile);
      formData.append("attempt", attemptFile);
      formData.append("shoba", selectedShoba);
      formData.append("notes", notes);

      const response = await fetch("/api/correct", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "خطأ غير معروف" }));
        throw new Error(err.error || `خطأ: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("لا يمكن قراءة الاستجابة");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let data: Record<string, unknown>;
          try {
            data = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (data.content) {
            fullText += data.content as string;
            pendingTextRef.current = fullText;
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                setStreamingText(pendingTextRef.current);
                if (boardRef.current) {
                  boardRef.current.scrollTop = boardRef.current.scrollHeight;
                }
                rafRef.current = null;
              });
            }
          }
          if (data.error) {
            throw new Error(data.error as string);
          }
          if (data.done) {
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            setStreamingText(fullText);
            const id = crypto.randomUUID();
            setHistory(prev => [{
              id,
              evaluation: fullText,
              date: new Date(),
              shoba: selectedShoba,
              exercisePreview: savedExercisePreview ?? undefined,
              attemptPreview: savedAttemptPreview ?? undefined,
            }, ...prev]);
            setStreamingText("");
            clearExercise();
            clearAttempt();
            setNotes("");
            if (!isActivated) {
              const newUsed = trialUsed + 1;
              setTrialUsed(newUsed);
              localStorage.setItem(TRIAL_KEY, String(newUsed));
              const left = TRIAL_MAX - newUsed;
              toast({
                title: "✅ اكتمل التصحيح!",
                description: left > 0
                  ? `باقي لك ${left} استخدام${left === 1 ? "" : "ات"} تجريبية.`
                  : "انتهت النسخة التجريبية — فعّل حسابك للاستمرار.",
              });
            } else {
              toast({ title: "✅ اكتمل التصحيح!", description: "تصحيحات غير محدودة — استمر!" });
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء التقييم";
      toast({ title: "خطأ في التقييم", description: msg, variant: "destructive" });
      setStreamingText("");
    } finally {
      setIsPending(false);
    }
  };

  const canSubmit = !!exerciseFile && !!attemptFile && (isActivated || !trialExpired);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
      {/* SIDEBAR */}
      <aside className="w-full md:w-80 lg:w-96 bg-card border-l border-border flex flex-col shrink-0 shadow-xl overflow-y-auto">
        <div className="p-6 flex-1 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", boxShadow: "0 2px 8px rgba(99,102,241,0.3)" }}>
                  <span className="text-sm font-black text-white" style={{ fontFamily: "serif" }}>Σ</span>
                </div>
                <div>
                  <h2 className="text-sm font-black text-foreground leading-tight">سِيغْمَا</h2>
                  <p className="text-xs text-primary/70 leading-tight">مصحح الرياضيات · بكالوريا 2026</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={toggle}
                className="p-2 text-muted-foreground hover:text-primary rounded-full transition-colors"
                title={isDark ? "الوضع النهاري" : "الوضع الليلي"}
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              <button
                onClick={handleLogout}
                className="p-2 text-muted-foreground hover:text-destructive rounded-full transition-colors"
                title="تسجيل الخروج"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Countdown */}
          <div className="bg-gradient-to-br from-primary/10 to-accent/10 border border-primary/20 rounded-2xl p-4 text-center">
            <CalendarDays className="w-5 h-5 text-primary mx-auto mb-1" />
            <p className="text-xs font-medium text-muted-foreground mb-1">باقي للبكالوريا 2026</p>
            <div className="text-4xl font-black text-primary">
              {daysLeft}
            </div>
            <p className="text-xs font-semibold text-muted-foreground mt-0.5">يوم</p>
          </div>

          {/* Account Status Badge */}
          {isActivated ? (
            <div
              className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.12) 0%, rgba(139,92,246,0.06) 100%)",
                border: "1.5px solid rgba(99,102,241,0.40)",
                boxShadow: "0 2px 8px rgba(99,102,241,0.10)",
              }}
            >
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(99,102,241,0.15)" }}>
                <ShieldCheck className="w-4 h-4" style={{ color: "#6366f1" }} />
              </div>
              <div>
                <p className="text-xs font-black leading-tight" style={{ color: "#6366f1" }}>حساب مفعّل ✨</p>
                <p className="text-xs leading-tight text-muted-foreground">تصحيحات غير محدودة — سنة كاملة</p>
              </div>
            </div>
          ) : !trialExpired ? (
            <div
              className="rounded-2xl px-4 py-3 space-y-2.5"
              style={{
                background: "linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(16,185,129,0.06) 100%)",
                border: "2px solid rgba(34,197,94,0.45)",
                boxShadow: "0 2px 8px rgba(34,197,94,0.12)",
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(34,197,94,0.18)", border: "1px solid rgba(34,197,94,0.4)" }}>
                  <span className="text-sm">🎁</span>
                </div>
                <div>
                  <p className="text-xs font-black leading-tight" style={{ color: "#16a34a" }}>نسخة تجريبية مجانية</p>
                  <p className="text-xs leading-tight" style={{ color: "rgba(22,163,74,0.75)" }}>
                    باقي <span className="font-black" style={{ color: "#16a34a" }}>{trialRemaining}</span> من {TRIAL_MAX} استخدامات
                  </p>
                </div>
                <button
                  onClick={() => setShowPayment(true)}
                  className="mr-auto text-xs font-bold px-2.5 py-1 rounded-lg transition-all hover:-translate-y-px"
                  style={{ background: "rgba(99,102,241,0.12)", color: "#6366f1", border: "1px solid rgba(99,102,241,0.25)" }}
                >
                  فعّل ↑
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: TRIAL_MAX }).map((_, i) => (
                  <div key={i} className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(34,197,94,0.18)" }}>
                    <div
                      className="h-full w-full rounded-full transition-all duration-300"
                      style={i < trialUsed
                        ? { background: "#ef4444", boxShadow: "0 0 6px rgba(239,68,68,0.7)" }
                        : { background: "#22c55e", boxShadow: "0 0 6px rgba(34,197,94,0.7)" }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-center" style={{ color: "rgba(22,163,74,0.65)" }}>
                {trialUsed === 0 ? "استمتع بـ 3 تصحيحات مجانية 🎉" : `استعملت ${trialUsed} من ${TRIAL_MAX} — باقي ${trialRemaining}`}
              </p>
            </div>
          ) : (
            <div
              className="rounded-2xl px-4 py-3.5 space-y-2.5"
              style={{
                background: "linear-gradient(135deg, rgba(239,68,68,0.13) 0%, rgba(225,29,72,0.07) 100%)",
                border: "2px solid rgba(239,68,68,0.5)",
                boxShadow: "0 2px 10px rgba(239,68,68,0.15)",
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.4)" }}>
                  <span className="text-sm">🔒</span>
                </div>
                <div>
                  <p className="text-xs font-black leading-tight" style={{ color: "#dc2626" }}>انتهت النسخة التجريبية</p>
                  <p className="text-xs leading-tight" style={{ color: "rgba(220,38,38,0.70)" }}>استعملت كل الـ {TRIAL_MAX} تصحيحات المجانية</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                {Array.from({ length: TRIAL_MAX }).map((_, i) => (
                  <div key={i} className="flex-1 h-2.5 rounded-full" style={{ background: "#ef4444", boxShadow: "0 0 6px rgba(239,68,68,0.55)" }} />
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground line-through">1000 دج</span>
                  <span className="font-black" style={{ color: "#6366f1" }}>500 دج — عرض سنوي</span>
                </div>
                <button
                  onClick={() => setShowPayment(true)}
                  className="w-full text-xs font-black text-white rounded-xl py-2 transition-all duration-150 hover:-translate-y-px"
                  style={{ background: "linear-gradient(135deg, #6366f1, #8b5cf6)", boxShadow: "0 3px 10px rgba(99,102,241,0.35)" }}
                >
                  🔓 فعّل الآن بـ 500 دج
                </button>
              </div>
            </div>
          )}

          <div className="h-px bg-border" />

          {/* Shoba */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground block">شعبتك في البكالوريا</label>
            <div className="relative">
              <select
                value={selectedShoba}
                onChange={(e) => setSelectedShoba(e.target.value)}
                className="w-full appearance-none bg-background border border-border hover:border-primary/50 rounded-xl px-4 py-2.5 text-sm text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
              >
                {SHOBAS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Exercise Upload */}
          <ImageUploadZone
            label="صورة التمرين"
            icon={<FileText className="w-3.5 h-3.5 text-primary" />}
            hint="نص السؤال / الوثيقة"
            file={exerciseFile}
            previewUrl={exercisePreviewUrl}
            onFileChange={setExercise}
            onClear={clearExercise}
          />

          {/* Attempt Upload */}
          <ImageUploadZone
            label="صورة محاولتك"
            icon={<PenLine className="w-3.5 h-3.5 text-accent" />}
            hint="ما كتبته بخط يدك"
            file={attemptFile}
            previewUrl={attemptPreviewUrl}
            onFileChange={setAttempt}
            onClear={clearAttempt}
          />

          {/* Notes */}
          <div className="rounded-2xl border border-amber-300/60 dark:border-amber-500/30 bg-gradient-to-br from-amber-50/80 to-yellow-50/50 dark:from-amber-900/15 dark:to-yellow-900/10 p-3.5 space-y-2 shadow-sm shadow-amber-100/60 dark:shadow-amber-900/10">
            <div className="flex items-center gap-2">
              <span className="text-base">💬</span>
              <label className="text-xs font-semibold text-amber-700 dark:text-amber-400">قل للأستاذ</label>
              <span className="text-xs text-amber-600/60 dark:text-amber-500/50 mr-auto">اختياري</span>
            </div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثلاً: ما فهمتش السؤال الثاني..."
              className="w-full bg-white/70 dark:bg-black/20 border border-amber-200/80 dark:border-amber-700/30 focus:border-amber-400 dark:focus:border-amber-500 rounded-xl px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-300/30 dark:focus:ring-amber-500/20 transition-all resize-none min-h-[60px] placeholder:text-amber-400/60 dark:placeholder:text-amber-600/50"
            />
          </div>

          {/* Submit */}
          <div className="mt-auto pt-1">
            <button
              onClick={handleSubmit}
              disabled={isPending || !canSubmit}
              className="w-full bg-gradient-to-l from-gray-900 via-slate-800 to-gray-900 font-black text-base rounded-xl py-3.5 px-5 border border-yellow-400/40 shadow-lg shadow-yellow-400/20 hover:shadow-xl hover:shadow-yellow-400/40 hover:border-yellow-300/60 hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin" />
                  <span className="text-yellow-200">جاري التصحيح...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-yellow-300 drop-shadow-[0_0_6px_rgba(253,224,71,0.8)]" />
                  <span className="text-yellow-300 drop-shadow-[0_0_8px_rgba(253,224,71,0.7)]">قيّم محاولتي</span>
                </>
              )}
            </button>
            {!canSubmit && (
              <p className="text-center text-xs text-muted-foreground mt-2">
                {trialExpired
                  ? <button onClick={() => setShowPayment(true)} className="text-primary font-bold hover:underline">فعّل حسابك (500 دج) للاستمرار ←</button>
                  : !exerciseFile
                    ? "ارفع صورة التمرين"
                    : "ارفع صورة محاولتك"}
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main ref={boardRef} className="flex-1 p-6 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-xl font-black text-foreground">السبورة الإلكترونية</h1>
            {history.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                مسح الكل
              </button>
            )}
          </div>

          {/* Streaming Result */}
          <AnimatePresence>
            {streamingText && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-card border-2 border-primary/30 rounded-2xl p-6 shadow-sm mb-4"
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs font-semibold text-primary">Σ سِيغْمَا يقيّم محاولتك...</span>
                  <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-bold px-2.5 py-0.5 rounded-full mr-auto">
                    <Sparkles className="w-3 h-3" />
                    {selectedShoba}
                  </span>
                </div>
                <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground leading-relaxed">
                  <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{streamingText}</ReactMarkdown>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* History */}
          {!streamingText && history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-20 h-20 rounded-2xl bg-primary/8 border border-primary/15 flex items-center justify-center mb-5">
                <MessageSquare className="w-10 h-10 text-primary/40" />
              </div>
              <h3 className="text-base font-bold text-foreground mb-2">السبورة فارغة</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                ارفع صورة التمرين وصورة محاولتك وسيقيّم سِيغْمَا إجابتك فوراً
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {history.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden"
                  >
                    <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border/60">
                      <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full">
                        <Sparkles className="w-3 h-3" />
                        {item.shoba}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">
                          {item.date.toLocaleDateString("ar-DZ")} · {item.date.toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <CopyButton text={item.evaluation} />
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-0">
                      {(item.exercisePreview || item.attemptPreview) && (
                        <div className="md:w-52 shrink-0 border-l border-border/60 flex flex-col">
                          {item.exercisePreview && (
                            <div className="flex-1 border-b border-border/40">
                              <p className="text-xs text-muted-foreground text-center pt-1.5 pb-0.5">التمرين</p>
                              <img
                                src={item.exercisePreview}
                                alt="صورة التمرين"
                                className="w-full h-28 object-contain bg-muted/20 p-1"
                              />
                            </div>
                          )}
                          {item.attemptPreview && (
                            <div className="flex-1">
                              <p className="text-xs text-muted-foreground text-center pt-1.5 pb-0.5">المحاولة</p>
                              <img
                                src={item.attemptPreview}
                                alt="صورة المحاولة"
                                className="w-full h-28 object-contain bg-muted/20 p-1"
                              />
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex-1 p-6 pt-4">
                        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{item.evaluation}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </main>
      </div>

      {/* Payment Modal */}
      <AnimatePresence>
        {showPayment && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={(e) => { if (e.target === e.currentTarget) { setShowPayment(false); setPayStep(1); setPayUploaded(false); } }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
              className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden"
            >
              {/* Header */}
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
                    onClick={() => { setShowPayment(false); setPayStep(1); setPayUploaded(false); }}
                    className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors text-lg leading-none"
                  >×</button>
                </div>
              </div>

              <div className="px-6 py-5 space-y-4">
                {/* Step indicators */}
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
                    <motion.div key="s1" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="space-y-3">
                      <div className="bg-muted/50 rounded-2xl p-3.5 space-y-2.5">
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">المبلغ</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground line-through">1000 دج</span>
                            <span className="text-base font-black" style={{ color: "#16a34a" }}>500 دج</span>
                          </div>
                        </div>
                        <div className="h-px bg-border" />
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">الطريقة</span>
                          <span className="text-sm font-bold text-foreground">بريدي موب</span>
                        </div>
                        <div className="h-px bg-border" />
                        <div className="space-y-1.5">
                          <span className="text-xs text-muted-foreground">رقم RIP — انقر للنسخ</span>
                          <RIPCopy rip="00799999002789880450" />
                        </div>
                      </div>
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300/60 rounded-xl px-3 py-2 text-xs text-amber-800 dark:text-amber-300 leading-relaxed font-medium">
                        ادفع <strong>500 دج</strong> عبر بريدي موب، ثم ارفع وصل الدفع في الخطوة التالية ✨
                      </div>
                      <button
                        onClick={() => setPayStep(2)}
                        className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-sm rounded-xl py-2.5 transition-all shadow-sm hover:-translate-y-px"
                      >
                        دفعت؟ ارفع الوصل ←
                      </button>
                    </motion.div>
                  )}

                  {payStep === 2 && (
                    <motion.div key="s2" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="space-y-3">
                      {payUploaded ? (
                        <div className="flex flex-col items-center gap-3 py-6">
                          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(34,197,94,0.12)", border: "2px solid rgba(34,197,94,0.4)" }}>
                            <CheckCircle2 className="w-7 h-7" style={{ color: "#22c55e" }} />
                          </div>
                          <div className="text-center">
                            <p className="text-base font-black text-foreground mb-0.5">🎉 تم تفعيل حسابك!</p>
                            <p className="text-xs text-muted-foreground">يمكنك الآن الاستخدام غير المحدود</p>
                          </div>
                          <button
                            onClick={() => { setShowPayment(false); setPayStep(1); setPayUploaded(false); }}
                            className="w-full flex items-center justify-center gap-2 font-bold text-sm rounded-xl py-2.5 text-white transition-all hover:-translate-y-px"
                            style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)", boxShadow: "0 4px 12px rgba(34,197,94,0.3)" }}
                          >
                            <Zap className="w-4 h-4" /> ابدأ الاستخدام الآن
                          </button>
                        </div>
                      ) : (
                        <>
                          <label className={`flex flex-col items-center gap-2.5 border-2 border-dashed rounded-2xl p-5 cursor-pointer transition-all ${isUploading ? "border-primary/40 bg-primary/5" : "border-border hover:border-primary/50 hover:bg-primary/4"}`}>
                            <input type="file" accept="image/*" className="hidden" onChange={handleActivateUpload} disabled={isUploading} />
                            {isUploading ? (
                              <>
                                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <span className="text-sm font-semibold text-primary">جاري التفعيل...</span>
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
                          <button onClick={() => setPayStep(1)} className="w-full text-xs text-muted-foreground hover:text-foreground font-medium transition-colors">
                            ← رجوع للخطوة السابقة
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

      {/* Footer */}
      <footer className="border-t border-border bg-card py-2">
        <div className="flex items-center justify-center gap-3 px-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
              <span className="text-xs font-black text-white" style={{ fontFamily: "serif" }}>Σ</span>
            </div>
            <span className="text-xs text-muted-foreground">سِيغْمَا © 2026 — جميع الحقوق محفوظة</span>
          </div>
          <span className="text-muted-foreground/40 text-xs hidden sm:inline">|</span>
          <a
            href="/privacy"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            سياسة الخصوصية
          </a>
        </div>
      </footer>
    </div>
  );
}
