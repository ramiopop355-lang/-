import { useState, useRef, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, CalendarDays, Upload, ChevronDown,
  Image as ImageIcon, XCircle, LogOut, MessageSquare, Moon, Sun, Copy, Check
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type HistoryItem = {
  id: string;
  correction: string;
  shoba: string;
  date: Date;
  imagePreview?: string;
};

const SHOBAS = ["علوم تجريبية", "رياضيات", "تقني رياضي", "لغات", "آداب", "تسيير"];
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

export default function Dashboard() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedShoba, setSelectedShoba] = useState(SHOBAS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const { isDark, toggle } = useDarkModeToggle();
  const daysLeft = Math.max(0, differenceInDays(BAC_DATE, new Date()));

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const f = e.target.files[0];
      setFile(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(f));
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && (f.type === "image/jpeg" || f.type === "image/png" || f.type === "image/jpg")) {
      setFile(f);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(f));
    }
  }, [previewUrl]);

  const clearFile = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClearHistory = () => {
    if (confirm("هل أنت متأكد من مسح جميع التصحيحات؟")) {
      setHistory([]);
      toast({ title: "تم مسح السبورة بنجاح" });
    }
  };

  const handleLogout = () => { logout(); setLocation("/login"); };

  const handleSubmit = async () => {
    if (!file) {
      toast({ title: "صور التمرين أولاً!", variant: "destructive" });
      return;
    }

    setIsPending(true);
    setStreamingText("");

    const savedPreview = previewUrl ? URL.createObjectURL(file) : null;

    try {
      const formData = new FormData();
      formData.append("image", file);
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
                correction: fullText,
                date: new Date(),
                shoba: selectedShoba,
                imagePreview: savedPreview ?? undefined,
              }, ...prev]);
              setStreamingText("");
              clearFile();
              setNotes("");
              toast({ title: "اكتمل التصحيح!", description: "تم تحليل التمرين بالذكاء الاصطناعي." });
            }
            if (data.error) {
              throw new Error(data.error);
            }
          } catch {
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "حدث خطأ أثناء التصحيح";
      toast({ title: "خطأ في التصحيح", description: msg, variant: "destructive" });
      setStreamingText("");
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* SIDEBAR */}
      <aside className="w-full md:w-80 lg:w-96 bg-card border-l border-border flex flex-col shrink-0 shadow-xl overflow-y-auto max-h-screen">
        <div className="p-6 flex-1 flex flex-col gap-5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-foreground">الشيخ الذكي</h2>
              <p className="text-xs text-highlight/75">مختبر التصحيح الذكي 2026</p>
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
            <label className="text-xs font-bold text-highlight/75 block">اختر شعبتك</label>
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

          {/* Upload */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-highlight/75 block">ارفع التمرين</label>
            <input
              type="file"
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={handleFileChange}
            />
            {!previewUrl ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                className="w-full border-2 border-dashed border-border hover:border-primary/60 bg-muted/30 hover:bg-primary/5 transition-all rounded-xl p-6 flex flex-col items-center gap-2 group"
              >
                <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Upload className="w-5 h-5 text-primary" />
                </div>
                <span className="text-sm font-semibold text-foreground/80">اختر صورة أو اسحبها</span>
                <span className="text-xs text-highlight/65">JPG, PNG · أقصى 10MB</span>
              </button>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-border group">
                <img src={previewUrl} alt="Preview" className="w-full h-44 object-contain bg-muted/30" />
                <div className="absolute inset-0 bg-background/70 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button onClick={() => fileInputRef.current?.click()} className="bg-primary text-primary-foreground p-2.5 rounded-full hover:scale-110 transition-transform shadow-lg">
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button onClick={clearFile} className="bg-destructive text-destructive-foreground p-2.5 rounded-full hover:scale-110 transition-transform shadow-lg">
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-highlight/75 block">ملاحظة للأستاذ (اختياري)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ما فهمتش السؤال الثالث..."
              className="w-full bg-background border border-border hover:border-primary/40 focus:border-primary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none min-h-[72px]"
            />
          </div>

          {/* Submit */}
          <div className="mt-auto pt-1">
            <button
              onClick={handleSubmit}
              disabled={isPending || !file}
              className="w-full bg-gradient-to-l from-primary to-accent text-primary-foreground font-black text-sm rounded-xl py-3.5 px-5 shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/35 hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 flex items-center justify-center gap-2"
            >
              {isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  الأستاذ يدقق...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span className="text-yellow-300">ابدأ التصحيح الذكي</span>
                </>
              )}
            </button>
            {!file && (
              <p className="text-center text-xs text-muted-foreground mt-2">
                ارفع صورة التمرين أولاً
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
                  <span className="text-xs font-bold text-primary">الشيخ الذكي يكتب التصحيح...</span>
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
                ارفع صورة تمرينك واختر شعبتك وسيصحح الشيخ الذكي تمرينك فوراً
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
                        <CopyButton text={item.correction} />
                      </div>
                    </div>

                    <div className="flex flex-col md:flex-row gap-0">
                      {item.imagePreview && (
                        <div className="md:w-48 shrink-0 border-l border-border/60">
                          <img
                            src={item.imagePreview}
                            alt="صورة التمرين"
                            className="w-full h-40 md:h-full object-contain bg-muted/20 p-2"
                          />
                        </div>
                      )}
                      <div className="flex-1 p-6 pt-4">
                        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground leading-relaxed">
                          <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>{item.correction}</ReactMarkdown>
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
  );
}
