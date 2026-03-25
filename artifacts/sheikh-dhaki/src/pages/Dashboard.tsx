import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, CalendarDays, Upload, ChevronDown,
  Image as ImageIcon, XCircle, LogOut, MessageSquare, Moon, Sun, Copy, Check,
  FileText, PenLine, Calculator
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
const BAC_DATE = new Date(2026, 5, 15);

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
  accentColor: string;
  file: File | null;
  previewUrl: string | null;
  onFileChange: (f: File) => void;
  onClear: () => void;
};

function ImageUploadZone({ label, icon, hint, accentColor, file, previewUrl, onFileChange, onClear }: ImageUploadZoneProps) {
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
      <div className="flex items-center gap-2">
        <div className={`w-5 h-5 rounded-md flex items-center justify-center ${accentColor}`}>
          {icon}
        </div>
        <label className="text-xs font-bold text-foreground">{label}</label>
        {file && <span className="mr-auto text-xs text-green-600 dark:text-green-400 font-medium">✓ جاهز</span>}
      </div>
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
          className="w-full border-2 border-dashed border-border hover:border-primary/50 bg-background hover:bg-primary/3 transition-all rounded-xl p-4 flex flex-col items-center gap-2 group"
        >
          <Upload className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
          <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{hint}</span>
        </button>
      ) : (
        <div className="relative rounded-xl overflow-hidden border-2 border-primary/30 group shadow-sm">
          <img src={previewUrl} alt="Preview" className="w-full h-32 object-contain bg-muted/20" />
          <div className="absolute inset-0 bg-background/75 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="bg-primary text-primary-foreground p-2 rounded-full shadow-lg hover:scale-110 transition-transform"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onClear}
              className="bg-destructive text-destructive-foreground p-2 rounded-full shadow-lg hover:scale-110 transition-transform"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-background/60 border border-border rounded-2xl p-4 space-y-3 ${className}`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b border-border/60">
      {icon}
      <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{label}</span>
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
            if (data.error) throw new Error(data.error);
          } catch { }
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

        {/* ═══════════ SIDEBAR ═══════════ */}
        <aside className="w-full md:w-80 lg:w-96 border-l border-border flex flex-col shrink-0 shadow-xl bg-card overflow-y-auto">

          {/* Brand Header */}
          <div className="h-0.5 bg-gradient-to-l from-primary via-primary/70 to-accent" />
          <div className="px-5 py-4 flex items-center justify-between border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Calculator className="w-4.5 h-4.5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-black text-foreground leading-tight">الشيخ الذكي</h2>
                <p className="text-xs text-muted-foreground">مقيّم الرياضيات · BAC 2026</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={toggle}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-primary hover:bg-muted transition-all"
                title={isDark ? "الوضع النهاري" : "الوضع الليلي"}
              >
                {isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>
              <button
                onClick={handleLogout}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-all"
                title="تسجيل الخروج"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="p-4 flex-1 flex flex-col gap-3">

            {/* Countdown */}
            <div className="bg-gradient-to-br from-primary to-accent rounded-2xl p-4 text-primary-foreground shadow-lg shadow-primary/20">
              <div className="flex items-center gap-2 mb-2 opacity-80">
                <CalendarDays className="w-3.5 h-3.5" />
                <span className="text-xs font-semibold">باقي للبكالوريا 2026</span>
              </div>
              <div className="flex items-end gap-2">
                <span className="text-5xl font-black leading-none">{daysLeft}</span>
                <span className="text-sm font-bold opacity-70 mb-1">يوم</span>
              </div>
            </div>

            {/* Shoba */}
            <SidebarSection>
              <SectionHeader icon={<ChevronDown className="w-3 h-3 text-muted-foreground" />} label="الشعبة" />
              <div className="relative">
                <select
                  value={selectedShoba}
                  onChange={(e) => setSelectedShoba(e.target.value)}
                  className="w-full appearance-none bg-background border border-border hover:border-primary/50 focus:border-primary rounded-xl px-3 py-2.5 text-sm font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                >
                  {SHOBAS.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
            </SidebarSection>

            {/* Images */}
            <SidebarSection>
              <SectionHeader icon={<Upload className="w-3 h-3 text-muted-foreground" />} label="الصور" />
              <ImageUploadZone
                label="صورة التمرين"
                icon={<FileText className="w-3 h-3 text-primary" />}
                accentColor="bg-primary/10"
                hint="نص السؤال / الوثيقة"
                file={exerciseFile}
                previewUrl={exercisePreviewUrl}
                onFileChange={setExercise}
                onClear={clearExercise}
              />
              <ImageUploadZone
                label="صورة محاولتك"
                icon={<PenLine className="w-3 h-3 text-amber-600" />}
                accentColor="bg-amber-500/10"
                hint="ما كتبته بخط يدك"
                file={attemptFile}
                previewUrl={attemptPreviewUrl}
                onFileChange={setAttempt}
                onClear={clearAttempt}
              />
            </SidebarSection>

            {/* Notes */}
            <SidebarSection>
              <SectionHeader icon={<MessageSquare className="w-3 h-3 text-muted-foreground" />} label="ملاحظة" />
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="مثلاً: ما فهمتش السؤال الثاني..."
                className="w-full bg-background border border-border hover:border-primary/40 focus:border-primary rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none min-h-[60px]"
              />
            </SidebarSection>

            {/* Submit */}
            <div className="mt-auto pt-1">
              <button
                onClick={handleSubmit}
                disabled={isPending || !canSubmit}
                className="w-full bg-gradient-to-l from-yellow-400 to-amber-500 text-gray-900 font-black text-base rounded-xl py-3.5 px-5 shadow-lg shadow-amber-400/30 hover:shadow-xl hover:shadow-amber-400/40 hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
              >
                {isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-gray-700 border-t-transparent rounded-full animate-spin" />
                    <span>الشيخ يقيّم...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>قيّم محاولتي</span>
                  </>
                )}
              </button>
              {!canSubmit && (
                <p className="text-center text-xs text-muted-foreground mt-2">
                  {!exerciseFile ? "① ارفع صورة التمرين" : "② ارفع صورة محاولتك"}
                </p>
              )}
            </div>
          </div>
        </aside>

        {/* ═══════════ MAIN BOARD ═══════════ */}
        <main ref={boardRef} className="flex-1 p-5 overflow-y-auto bg-background">
          <div className="max-w-3xl mx-auto">

            {/* Board Header */}
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-primary" />
                <h1 className="text-base font-black text-foreground">السبورة الإلكترونية</h1>
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClearHistory}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors px-2 py-1 rounded-lg hover:bg-destructive/8"
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
                  className="bg-card border-2 border-primary/40 rounded-2xl overflow-hidden shadow-md shadow-primary/10 mb-4"
                >
                  <div className="flex items-center gap-2 px-5 py-3 bg-primary/6 border-b border-primary/20">
                    <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                    <span className="text-xs font-bold text-primary">الشيخ الذكي يقيّم محاولتك...</span>
                    <span className="mr-auto inline-flex items-center gap-1 bg-primary/15 text-primary text-xs font-bold px-2.5 py-0.5 rounded-full">
                      <Sparkles className="w-3 h-3" />
                      {selectedShoba}
                    </span>
                  </div>
                  <div className="p-5 prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground leading-relaxed">
                    <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{streamingText}</ReactMarkdown>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Empty State */}
            {!streamingText && history.length === 0 && (
              <div className="flex flex-col items-center justify-center py-24 text-center">
                <div className="w-20 h-20 rounded-2xl bg-primary/8 border-2 border-primary/15 flex items-center justify-center mb-5 shadow-inner">
                  <Calculator className="w-9 h-9 text-primary/35" />
                </div>
                <h3 className="text-base font-bold text-foreground mb-2">السبورة فارغة</h3>
                <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                  ارفع صورة التمرين وصورة محاولتك، وسيقيّم الشيخ الذكي إجابتك ويعطيك تنقيطاً تفصيلياً
                </p>
                <div className="flex items-center gap-4 mt-6 text-xs text-muted-foreground/60">
                  <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> التمرين</span>
                  <span className="text-border">+</span>
                  <span className="flex items-center gap-1"><PenLine className="w-3 h-3" /> محاولتك</span>
                  <span className="text-border">→</span>
                  <span className="flex items-center gap-1"><Sparkles className="w-3 h-3" /> التقييم</span>
                </div>
              </div>
            )}

            {/* History */}
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
                    {/* Card Header */}
                    <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/60 bg-muted/20">
                      <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full border border-primary/20">
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

                    <div className="flex flex-col md:flex-row">
                      {/* Images column */}
                      {(item.exercisePreview || item.attemptPreview) && (
                        <div className="md:w-48 shrink-0 border-l border-border/60 bg-muted/10 flex flex-col divide-y divide-border/40">
                          {item.exercisePreview && (
                            <div className="flex-1">
                              <p className="text-xs text-muted-foreground text-center pt-2 pb-1 font-medium">التمرين</p>
                              <img src={item.exercisePreview} alt="صورة التمرين" className="w-full h-28 object-contain p-1" />
                            </div>
                          )}
                          {item.attemptPreview && (
                            <div className="flex-1">
                              <p className="text-xs text-muted-foreground text-center pt-2 pb-1 font-medium">المحاولة</p>
                              <img src={item.attemptPreview} alt="صورة المحاولة" className="w-full h-28 object-contain p-1" />
                            </div>
                          )}
                        </div>
                      )}
                      {/* Content */}
                      <div className="flex-1 p-5">
                        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{item.evaluation}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="border-t border-border bg-card py-2 text-center">
        <a href="/privacy" className="text-xs text-muted-foreground hover:text-primary transition-colors">
          سياسة الخصوصية (Privacy Policy)
        </a>
      </footer>
    </div>
  );
}
