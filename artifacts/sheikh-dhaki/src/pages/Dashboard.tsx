import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, CalendarDays, Upload, ChevronDown,
  Image as ImageIcon, XCircle, LogOut, MessageSquare, Moon, Sun, Copy, Check,
  FileText, PenLine
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
    if (f && (f.type === "image/jpeg" || f.type === "image/png" || f.type === "image/jpg")) {
      onFileChange(f);
    }
  }, [onFileChange]);

  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold text-highlight/75 flex items-center gap-1.5">
        {icon}
        {label}
      </label>
      <input
        type="file"
        ref={inputRef}
        accept="image/jpeg,image/png,image/jpg"
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
          <span className="text-xs font-semibold text-foreground/80">اختر صورة أو اسحبها</span>
          <span className="text-xs text-highlight/55">{hint}</span>
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
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const boardRef = useRef<HTMLDivElement>(null);
  const { isDark, toggle } = useDarkModeToggle();
  const daysLeft = Math.max(0, differenceInDays(BAC_DATE, new Date()));

  useEffect(() => {
    return () => {
      if (exercisePreviewUrl) URL.revokeObjectURL(exercisePreviewUrl);
      if (attemptPreviewUrl) URL.revokeObjectURL(attemptPreviewUrl);
    };
  }, [exercisePreviewUrl, attemptPreviewUrl]);

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

  const handleSubmit = async () => {
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
          try {
            const data = JSON.parse(line.slice(6));
            if (data.content) {
              fullText += data.content;
              setStreamingText(fullText);
              if (boardRef.current) {
                boardRef.current.scrollTop = boardRef.current.scrollHeight;
              }
            }
            if (data.done) {
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
              toast({ title: "اكتمل التقييم!", description: "تم تقييم محاولتك بالذكاء الاصطناعي." });
            }
            if (data.error) {
              throw new Error(data.error);
            }
          } catch {
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

  const canSubmit = !!exerciseFile && !!attemptFile;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
      {/* SIDEBAR */}
      <aside className="w-full md:w-80 lg:w-96 bg-card border-l border-border flex flex-col shrink-0 shadow-xl overflow-y-auto">
        <div className="p-6 flex-1 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-foreground">أستاذ الرياضيات</h2>
              <p className="text-xs text-highlight/75">مصحح الرياضيات — بكالوريا 2026</p>
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
            <p className="text-xs text-highlight/70 mb-1">باقي للبكالوريا 2026</p>
            <div className="text-4xl font-black text-primary">
              {daysLeft}
            </div>
            <p className="text-xs font-semibold text-highlight/65 mt-0.5">يوم</p>
          </div>

          <div className="h-px bg-border" />

          {/* Shoba */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-highlight/75 block">شعبتك في البكالوريا</label>
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
              <label className="text-xs font-black text-amber-700 dark:text-amber-400">قل للأستاذ</label>
              <span className="text-xs text-amber-500/70 dark:text-amber-500/50 mr-auto">اختياري</span>
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
                {!exerciseFile ? "ارفع صورة التمرين" : "ارفع صورة محاولتك"}
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
                  <span className="text-xs font-bold text-primary">أستاذ الرياضيات يقيّم محاولتك...</span>
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
              <p className="text-sm text-highlight/65 max-w-xs">
                ارفع صورة التمرين وصورة محاولتك وسيقيّم أستاذ الرياضيات إجابتك فوراً
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

      {/* Footer */}
      <footer className="border-t border-border bg-card py-2">
        <div className="flex items-center justify-center gap-3 flex-wrap px-4">
          <a
            href="/privacy"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            سياسة الخصوصية (Privacy Policy)
          </a>
          <span className="text-muted-foreground/30 text-xs">|</span>
          <span className="text-xs text-muted-foreground/70">
            تم برمجته من طرف{" "}
            <span className="font-bold text-primary/80">w-merada</span>
          </span>
        </div>
      </footer>
    </div>
  );
}
