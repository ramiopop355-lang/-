import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, CalendarDays, Upload, ChevronDown,
  Image as ImageIcon, XCircle, LogOut, MessageSquare
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useLocation } from "wouter";

type HistoryItem = { id: string; correction: string; shoba: string; date: Date };

const SHOBAS = ["علوم تجريبية", "رياضيات", "تقني رياضي", "لغات", "آداب", "تسيير"];
const BAC_DATE = new Date(2026, 5, 15);

export default function Dashboard() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [selectedShoba, setSelectedShoba] = useState(SHOBAS[0]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isPending, setIsPending] = useState(false);
  const { logout } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const daysLeft = Math.max(0, differenceInDays(BAC_DATE, new Date()));

  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const f = e.target.files[0];
      setFile(f);
      setPreviewUrl(URL.createObjectURL(f));
    }
  };

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
    setTimeout(() => {
      setHistory(prev => [{
        id: crypto.randomUUID(),
        correction: `## التصحيح النموذجي\n\n**الشعبة:** ${selectedShoba}\n\n### الحل:\nهذا تصحيح تجريبي للتمرين المرفق. يرجى ربط النظام بالذكاء الاصطناعي لتصحيح حقيقي.\n\n${notes ? `**ملاحظة الطالب:** ${notes}` : ""}`,
        date: new Date(),
        shoba: selectedShoba
      }, ...prev]);
      toast({ title: "اكتمل التصحيح!", description: "تم تحليل التمرين وإضافة الحل النموذجي." });
      clearFile();
      setNotes("");
      setIsPending(false);
    }, 2000);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* SIDEBAR */}
      <aside className="w-full md:w-80 lg:w-96 bg-card border-l border-border flex flex-col shrink-0 shadow-xl overflow-y-auto max-h-screen">
        <div className="p-6 flex-1 flex flex-col gap-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-black text-foreground">لوحة التحكم</h2>
            <button
              onClick={handleLogout}
              className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Countdown */}
          <div className="bg-primary/8 border border-primary/20 rounded-2xl p-4 text-center">
            <CalendarDays className="w-6 h-6 text-primary mx-auto mb-1.5" />
            <p className="text-xs text-muted-foreground mb-1">باقي للبكالوريا</p>
            <div className="text-3xl font-black text-foreground">
              {daysLeft} <span className="text-base font-semibold text-muted-foreground">يوم</span>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Shoba */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground block">اختر شعبتك</label>
            <div className="relative">
              <select
                value={selectedShoba}
                onChange={(e) => setSelectedShoba(e.target.value)}
                className="w-full appearance-none bg-background border border-border hover:border-primary/50 rounded-xl px-4 py-3 text-sm text-foreground font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all cursor-pointer"
              >
                {SHOBAS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Upload */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground block">ارفع التمرين</label>
            <input type="file" ref={fileInputRef} accept="image/jpeg,image/png,image/jpg" className="hidden" onChange={handleFileChange} />
            {!previewUrl ? (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border hover:border-primary/50 bg-muted/50 hover:bg-primary/5 transition-all rounded-xl p-6 flex flex-col items-center gap-2.5 group"
              >
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Upload className="w-5 h-5 text-primary" />
                </div>
                <span className="text-sm font-semibold text-foreground/80">اختر صورة أو اسحبها</span>
                <span className="text-xs text-muted-foreground">JPG, PNG بدقة عالية</span>
              </button>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-border group">
                <img src={previewUrl} alt="Preview" className="w-full h-40 object-contain bg-muted/30" />
                <div className="absolute inset-0 bg-background/60 backdrop-blur-sm opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button onClick={() => fileInputRef.current?.click()} className="bg-primary text-primary-foreground p-2.5 rounded-full hover:scale-110 transition-transform">
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button onClick={clearFile} className="bg-destructive text-destructive-foreground p-2.5 rounded-full hover:scale-110 transition-transform">
                    <XCircle className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground block">ملاحظة للأستاذ (اختياري)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="ما فهمتش السؤال الثالث..."
              className="w-full bg-background border border-border hover:border-primary/40 focus:border-primary rounded-xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none min-h-[80px]"
            />
          </div>

          {/* Submit */}
          <div className="mt-auto pt-2">
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
                  ابدأ التصحيح
                </>
              )}
            </button>
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 p-6 overflow-y-auto">
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

          {history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-primary/60" />
              </div>
              <h3 className="text-base font-bold text-foreground mb-1">السبورة فارغة</h3>
              <p className="text-sm text-muted-foreground">ارفع تمريناً وابدأ التصحيح الذكي</p>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence>
                {history.map((item) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-card border border-border rounded-2xl p-6 shadow-sm"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <span className="inline-flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-bold px-3 py-1 rounded-full">
                        <Sparkles className="w-3 h-3" />
                        {item.shoba}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {item.date.toLocaleDateString("ar-DZ")}
                      </span>
                    </div>
                    <div className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                      {item.correction}
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
