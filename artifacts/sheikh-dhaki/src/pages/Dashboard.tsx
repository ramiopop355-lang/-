import React, { useState, useRef, useEffect, useCallback, lazy, Suspense } from "react";
import { useToast } from "@/hooks/use-toast";
import { useDarkModeToggle } from "@/hooks/use-dark-mode";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles, Trash2, CalendarDays, Upload, ChevronDown,
  Image as ImageIcon, XCircle, LogOut, MessageSquare, Moon, Sun, Copy, Check,
  FileText, PenLine, CheckCircle2, Zap, ShieldCheck, Share2
} from "lucide-react";
import { useAuth, getDeviceId } from "@/context/AuthContext";
import { useLocation } from "wouter";

const MathMarkdown = lazy(() => import("@/components/MathMarkdown"));

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
const XP_KEY = "sigma-xp";
const STREAK_KEY = "sigma-streak";
const HISTORY_PREFIX = "sigma:history:";
const MAX_HISTORY_ITEMS = 30;
const THUMB_MAX_PX = 240;
const THUMB_QUALITY = 0.55;

// ── إنشاء صورة مصغّرة (thumbnail) كـ data URL لحفظها في localStorage ──
async function fileToThumbnailDataUrl(file: File | null): Promise<string | undefined> {
  if (!file) return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const ratio = THUMB_MAX_PX / Math.max(bitmap.width, bitmap.height, 1);
    const w = Math.max(1, Math.round(bitmap.width * Math.min(ratio, 1)));
    const h = Math.max(1, Math.round(bitmap.height * Math.min(ratio, 1)));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", THUMB_QUALITY);
  } catch {
    return undefined;
  }
}

function historyKeyFor(username: string | undefined | null): string {
  return `${HISTORY_PREFIX}${(username ?? "guest").toLowerCase().trim()}`;
}

function loadHistoryFromStorage(username: string | undefined | null): HistoryItem[] {
  try {
    const raw = localStorage.getItem(historyKeyFor(username));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<HistoryItem, "date"> & { date: string }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({ ...item, date: new Date(item.date) }));
  } catch {
    return [];
  }
}

function saveHistoryToStorage(username: string | undefined | null, items: HistoryItem[]): void {
  try {
    const trimmed = items.slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(historyKeyFor(username), JSON.stringify(trimmed));
  } catch (err) {
    // تخزين ممتلئ — نُسقط أقدم العناصر
    try {
      const minimal = items.slice(0, 10).map(i => ({ ...i, exercisePreview: undefined, attemptPreview: undefined }));
      localStorage.setItem(historyKeyFor(username), JSON.stringify(minimal));
    } catch {
      console.warn("[history] فشل حفظ السجل في التخزين المحلي:", err);
    }
  }
}

// ── ضغط الصور قبل الرفع ─────────────────────────────────────────
// الهدف: تقليص صور الهاتف (3-10 MB) إلى أقل من 1.2 MB
const MAX_PX   = 1920;  // الحد الأقصى للبُعد الأطول (بكسل)
const IMG_QUAL = 0.82;  // جودة JPEG (82٪ — توازن بين الجودة والحجم)
const MAX_BYTES = 1.2 * 1024 * 1024; // 1.2 MB

async function compressImage(file: File): Promise<File> {
  // إذا كان الملف صغيراً أصلاً (< 1.2 MB) → لا حاجة لضغط
  if (file.size <= MAX_BYTES) return file;

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;

      // تصغير الأبعاد مع الحفاظ على نسبة العرض إلى الارتفاع
      if (width > MAX_PX || height > MAX_PX) {
        if (width >= height) {
          height = Math.round((height * MAX_PX) / width);
          width  = MAX_PX;
        } else {
          width  = Math.round((width * MAX_PX) / height);
          height = MAX_PX;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width  = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }

      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const compressed = new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
          resolve(compressed);
        },
        "image/jpeg",
        IMG_QUAL
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("فشل تحميل الصورة")); };
    img.src = url;
  });
}

type ResultBlock = { grade: number | null; xpGain: number; streakGain: number; level: string; note: string };

function parseResultBlock(text: string): ResultBlock | null {
  const sec = text.match(/📌\s*النتيجة[:\s]*([\s\S]*?)(?:\n---|\n\*سِيغْمَا|$)/);
  if (!sec) return null;
  const line = sec[1].trim();
  const gradeM = line.match(/العلامة:\s*(\d+)\s*\/\s*20/);
  const xpM    = line.match(/XP:\s*\+?(\d+)/);
  const strM   = line.match(/الاستمرارية:\s*\+?(\d+)/);
  const lvlM   = line.match(/المستوى:\s*([^\|]+)/);
  const noteM  = line.match(/ملاحظة:\s*(.+)/);
  if (!gradeM && !xpM) return null;
  return {
    grade:       gradeM ? parseInt(gradeM[1]) : null,
    xpGain:      xpM    ? parseInt(xpM[1])    : 0,
    streakGain:  strM   ? parseInt(strM[1])   : 0,
    level:       lvlM   ? lvlM[1].trim()      : "",
    note:        noteM  ? noteM[1].trim()      : "",
  };
}

// ── آية اليوم + عداد الباك ─────────────────────────────────────────
const QURAN_VERSES = [
  { text: "وَقُل رَّبِّ زِدْنِي عِلْمًا",                                                                      ref: "سورة طه — ١١٤"         },
  { text: "إِنَّ مَعَ الْعُسْرِ يُسْرًا",                                                                       ref: "سورة الشرح — ٦"         },
  { text: "يَرْفَعِ اللَّهُ الَّذِينَ آمَنُوا مِنكُمْ وَالَّذِينَ أُوتُوا الْعِلْمَ دَرَجَاتٍ",              ref: "سورة المجادلة — ١١"     },
  { text: "وَمَن يَتَوَكَّلْ عَلَى اللَّهِ فَهُوَ حَسْبُهُ",                                                   ref: "سورة الطلاق — ٣"        },
  { text: "وَبَشِّرِ الصَّابِرِينَ",                                                                            ref: "سورة البقرة — ١٥٥"      },
  { text: "إِنَّ اللَّهَ لَا يُضِيعُ أَجْرَ الْمُحْسِنِينَ",                                                  ref: "سورة هود — ١١٥"         },
  { text: "وَاصْبِرْ وَمَا صَبْرُكَ إِلَّا بِاللَّهِ",                                                         ref: "سورة النحل — ١٢٧"       },
  { text: "وَعَلَّمَكَ مَا لَمْ تَكُن تَعْلَمُ ۚ وَكَانَ فَضْلُ اللَّهِ عَلَيْكَ عَظِيمًا",                 ref: "سورة النساء — ١١٣"      },
  { text: "وَاللَّهُ يُحِبُّ الصَّابِرِينَ",                                                                    ref: "سورة آل عمران — ١٤٦"   },
  { text: "إِنَّ اللَّهَ مَعَ الَّذِينَ اتَّقَوْا وَّالَّذِينَ هُم مُّحْسِنُونَ",                             ref: "سورة النحل — ١٢٨"       },
  { text: "وَمَن جَاهَدَ فَإِنَّمَا يُجَاهِدُ لِنَفْسِهِ",                                                    ref: "سورة العنكبوت — ٦"      },
  { text: "وَقَالَ رَبُّكُمُ ادْعُونِي أَسْتَجِبْ لَكُمْ",                                                    ref: "سورة غافر — ٦٠"         },
  { text: "إِنَّ اللَّهَ لَا يُغَيِّرُ مَا بِقَوْمٍ حَتَّىٰ يُغَيِّرُوا مَا بِأَنفُسِهِمْ",                 ref: "سورة الرعد — ١١"        },
  { text: "وَمَا تَوْفِيقِي إِلَّا بِاللَّهِ ۚ عَلَيْهِ تَوَكَّلْتُ",                                        ref: "سورة هود — ٨٨"          },
  { text: "فَإِذَا فَرَغْتَ فَانصَبْ ۝ وَإِلَىٰ رَبِّكَ فَارْغَب",                                           ref: "سورة الشرح — ٧-٨"       },
  { text: "يَا أَيُّهَا الَّذِينَ آمَنُوا اسْتَعِينُوا بِالصَّبْرِ وَالصَّلَاةِ",                            ref: "سورة البقرة — ١٥٣"      },
  { text: "وَلَسَوْفَ يُعْطِيكَ رَبُّكَ فَتَرْضَىٰ",                                                          ref: "سورة الضحى — ٥"         },
  { text: "مَن كَانَ يُرِيدُ حَرْثَ الْآخِرَةِ نَزِدْ لَهُ فِي حَرْثِهِ",                                    ref: "سورة الشورى — ٢٠"       },
  { text: "فَبِمَا رَحْمَةٍ مِّنَ اللَّهِ لِنتَ لَهُمْ",                                                      ref: "سورة آل عمران — ١٥٩"   },
  { text: "وَقُلِ اعْمَلُوا فَسَيَرَى اللَّهُ عَمَلَكُمْ وَرَسُولُهُ وَالْمُؤْمِنُونَ",                      ref: "سورة التوبة — ١٠٥"      },
  { text: "وَلَا تَيْأَسُوا مِن رَّوْحِ اللَّهِ",                                                              ref: "سورة يوسف — ٨٧"         },
  { text: "رَبَّنَا آتِنَا مِن لَّدُنكَ رَحْمَةً وَهَيِّئْ لَنَا مِنْ أَمْرِنَا رَشَدًا",                   ref: "سورة الكهف — ١٠"        },
];

function DailyVerse() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  const verse = QURAN_VERSES[dayOfYear % QURAN_VERSES.length];

  return (
    <div
      className="mt-5 rounded-2xl px-5 py-4 flex items-center justify-center gap-3 text-center"
      style={{
        background: "linear-gradient(135deg, rgba(99,102,241,0.07) 0%, rgba(139,92,246,0.04) 100%)",
        border: "1px solid rgba(99,102,241,0.15)",
      }}
    >
      <span className="text-primary/30 text-2xl shrink-0 leading-none select-none" style={{ fontFamily: "'Amiri', serif" }}>﴿</span>
      <div className="text-center">
        <p
          className="text-base leading-relaxed text-foreground/85"
          style={{ fontFamily: "'Amiri', serif", fontWeight: 700, letterSpacing: "0.02em" }}
        >
          {verse.text}
        </p>
        <p className="text-xs text-primary/50 font-medium mt-1 tracking-wide">{verse.ref}</p>
      </div>
      <span className="text-primary/30 text-2xl shrink-0 leading-none select-none" style={{ fontFamily: "'Amiri', serif" }}>﴾</span>
    </div>
  );
}


// ── تحليل الرد إلى أقسام ───────────────────────────────────────────
interface AISection { title: string; content: string; }

const SECTION_STYLES: Record<string, { icon: string; label: string; header: string; border: string; bg: string }> = {
  "الحكم":                    { icon: "⚖️", label: "الحكم",                   header: "text-foreground",                                           border: "border-r-4 border-primary/50",           bg: "bg-primary/5 dark:bg-primary/8"                           },
  "أين أخطأ الطالب":         { icon: "🔍", label: "أين أخطأ الطالب",          header: "text-orange-700 dark:text-orange-400",                      border: "border-r-4 border-orange-400 dark:border-orange-600", bg: "bg-orange-50 dark:bg-orange-950/30"                       },
  "التصحيح":                  { icon: "✏️", label: "التصحيح",                  header: "text-blue-700 dark:text-blue-400",                          border: "border-r-4 border-blue-400 dark:border-blue-600",    bg: "bg-blue-50 dark:bg-blue-950/30"                           },
  "الحل النموذجي المختصر":   { icon: "📝", label: "الحل النموذجي",            header: "text-violet-700 dark:text-violet-400",                      border: "border-r-4 border-violet-400 dark:border-violet-600",bg: "bg-violet-50 dark:bg-violet-950/30"                       },
  "الحل المنهجي":             { icon: "📐", label: "الحل المنهجي الكامل",      header: "text-indigo-700 dark:text-indigo-400",                      border: "border-r-4 border-indigo-400 dark:border-indigo-600",bg: "bg-indigo-50 dark:bg-indigo-950/30"                       },
  "قراءة التمرين":            { icon: "📖", label: "قراءة التمرين",            header: "text-foreground",                                           border: "border-r-4 border-muted-foreground/30",              bg: "bg-muted/40"                                              },
  "التحقق":                   { icon: "✅", label: "التحقق",                   header: "text-green-700 dark:text-green-400",                        border: "border-r-4 border-green-400 dark:border-green-600",  bg: "bg-green-50 dark:bg-green-950/30"                         },
  "التحقق من النتيجة":        { icon: "✅", label: "التحقق",                   header: "text-green-700 dark:text-green-400",                        border: "border-r-4 border-green-400 dark:border-green-600",  bg: "bg-green-50 dark:bg-green-950/30"                         },
  "نصيحة":                    { icon: "💡", label: "نصيحة للامتحان",           header: "text-amber-700 dark:text-amber-400",                        border: "border-r-4 border-amber-400 dark:border-amber-500",  bg: "bg-amber-50 dark:bg-amber-950/30"                         },
  "نصيحة للامتحان":           { icon: "💡", label: "نصيحة للامتحان",           header: "text-amber-700 dark:text-amber-400",                        border: "border-r-4 border-amber-400 dark:border-amber-500",  bg: "bg-amber-50 dark:bg-amber-950/30"                         },
  "النتيجة":                   { icon: "🏆", label: "النتيجة",                   header: "text-green-700 dark:text-green-400",                        border: "border-r-4 border-green-500 dark:border-green-500",  bg: "bg-green-50 dark:bg-green-950/30"                         },
};

function getStyle(title: string) {
  return SECTION_STYLES[title] ?? { icon: "📌", label: title, header: "text-foreground", border: "border-r-4 border-border", bg: "bg-muted/20" };
}

function parseAIResponse(text: string): AISection[] | null {
  if (!text.includes("📌")) return null;
  const parts = text.split(/\n(?=\s*\*{0,2}📌)/);
  if (parts.length <= 1) return null;
  const sections: AISection[] = [];
  for (const part of parts) {
    const trimmed = part.replace(/^\s*-{3,}\s*\n?/, "").replace(/\n?\s*-{3,}\s*$/, "").trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^\*{0,2}📌\s*([^:\n*]+):?\*{0,2}\s*([\s\S]*)/);
    if (m) sections.push({ title: m[1].trim(), content: m[2].trim() });
    else sections.push({ title: "", content: trimmed });
  }
  return sections.length > 1 ? sections : null;
}

function VerdictBadge({ text }: { text: string }) {
  const ok  = text.includes("✔️") || text.includes("صحيح");
  const mid = text.includes("⚠️") || text.includes("ناقص");
  const bad = text.includes("❌") || text.includes("خطأ");
  const cls = ok  ? "bg-green-100 border-green-300 text-green-800 dark:bg-green-950/60 dark:border-green-700 dark:text-green-300"
            : mid ? "bg-amber-100 border-amber-300 text-amber-800 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-300"
            : bad ? "bg-red-100   border-red-300   text-red-800   dark:bg-red-950/60   dark:border-red-700   dark:text-red-300"
                  : "bg-muted border-border text-foreground";
  const label = ok ? "✔️ صحيح — إجابتك سليمة رياضياً"
              : mid ? "⚠️ ناقص — صحيح لكن يوجد نقص في الخطوات"
              : bad ? "❌ خطأ — يوجد خطأ رياضي يؤثر على النتيجة"
                    : text;
  return (
    <div className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl border-2 font-bold text-base ${cls}`}>
      {label}
    </div>
  );
}

const ProseBlock = React.memo(function ProseBlock({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground leading-relaxed">
      <Suspense fallback={<div className="whitespace-pre-wrap text-foreground/80">{text}</div>}>
        <MathMarkdown text={text} />
      </Suspense>
    </div>
  );
});

function ResultCard({ content }: { content: string }) {
  const r = parseResultBlock(`📌 النتيجة: ${content}`);
  if (!r) return <ProseBlock text={content} />;
  const gradeColor = r.grade !== null
    ? r.grade >= 16 ? "text-green-600 dark:text-green-400"
    : r.grade >= 10 ? "text-amber-600 dark:text-amber-400"
    : "text-red-600 dark:text-red-400"
    : "text-foreground";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {r.grade !== null && (
          <div className="flex flex-col items-center justify-center bg-white/60 dark:bg-black/20 rounded-xl py-3 border border-green-200 dark:border-green-800">
            <span className={`text-3xl font-black leading-none ${gradeColor}`}>{r.grade}</span>
            <span className="text-xs text-muted-foreground mt-1 font-medium">/20</span>
          </div>
        )}
        <div className="flex flex-col items-center justify-center bg-white/60 dark:bg-black/20 rounded-xl py-3 border border-green-200 dark:border-green-800">
          <span className="text-2xl font-black text-green-600 dark:text-green-400 leading-none">+{r.xpGain}</span>
          <span className="text-xs text-muted-foreground mt-1 font-medium">XP</span>
        </div>
        <div className="flex flex-col items-center justify-center bg-white/60 dark:bg-black/20 rounded-xl py-3 border border-green-200 dark:border-green-800">
          <span className="text-2xl leading-none">{r.streakGain > 0 ? "🔥" : "❄️"}</span>
          <span className="text-xs text-muted-foreground mt-1 font-medium">{r.streakGain > 0 ? "+1 يوم" : "توقف"}</span>
        </div>
      </div>
      {r.level && (
        <div className="flex items-center gap-2 bg-white/60 dark:bg-black/20 rounded-xl px-4 py-2.5 border border-green-200 dark:border-green-800">
          <span className="text-lg">{r.level.includes("🔥") ? "🔥" : r.level.includes("👍") ? "👍" : "❌"}</span>
          <span className="text-sm font-bold text-foreground">{r.level.replace(/^[🔥👍❌]\s*/, "")}</span>
        </div>
      )}
      {r.note && (
        <p className="text-sm text-green-800 dark:text-green-300 font-medium italic px-1">" {r.note} "</p>
      )}
    </div>
  );
}

function XpStreakWidget({ xp, streak }: { xp: number; streak: number }) {
  const [displayed, setDisplayed] = useState(xp);
  const prevXp = useRef(xp);
  useEffect(() => {
    const from = prevXp.current;
    const to = xp;
    if (from === to) return;
    const diff = to - from;
    const steps = 40;
    const interval = 25;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      const eased = Math.round(from + diff * (1 - Math.pow(1 - step / steps, 3)));
      setDisplayed(eased);
      if (step >= steps) { clearInterval(timer); setDisplayed(to); prevXp.current = to; }
    }, interval);
    return () => clearInterval(timer);
  }, [xp]);
  return (
    <div
      className="rounded-2xl p-4 flex items-center gap-4"
      style={{
        background: "linear-gradient(135deg, #059669 0%, #10b981 60%, #34d399 100%)",
        boxShadow: "0 8px 32px -8px rgba(5,150,105,0.55)",
      }}
    >
      <div className="flex-1 text-center">
        <p className="text-[10px] font-semibold text-white/75 uppercase tracking-wider mb-1">نقاط XP</p>
        <p className="text-3xl font-black text-white leading-none transition-all tabular-nums">
          {displayed.toLocaleString("ar-DZ")}
        </p>
      </div>
      <div className="w-px h-10 bg-white/30" />
      <div className="flex-1 text-center">
        <p className="text-[10px] font-semibold text-white/75 uppercase tracking-wider mb-1">الاستمرارية</p>
        <div className="flex items-center justify-center gap-1">
          <span className="text-xl">{streak > 0 ? "🔥" : "💤"}</span>
          <span className="text-2xl font-black text-white leading-none tabular-nums">{streak}</span>
        </div>
      </div>
    </div>
  );
}

function SectionCard({ section }: { section: AISection }) {
  const s = getStyle(section.title);
  const isVerdict = section.title === "الحكم";
  const isResult  = section.title === "النتيجة";
  return (
    <div className={`rounded-xl overflow-hidden ${s.border} ${s.bg}`} style={{ boxShadow: "0 2px 8px -2px rgba(0,0,0,0.06)" }}>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-black/5 dark:border-white/5" style={{ background: "rgba(0,0,0,0.015)" }}>
        <span className="text-sm leading-none">{s.icon}</span>
        <span className={`text-[0.8rem] font-bold tracking-wide ${s.header}`}>{s.label}</span>
      </div>
      <div className="px-4 py-3">
        {isVerdict ? <VerdictBadge text={section.content} />
        : isResult  ? <ResultCard content={section.content} />
        : <ProseBlock text={section.content} />}
      </div>
    </div>
  );
}

const MarkdownResult = React.memo(function MarkdownResult({ text }: { text: string }) {
  const sections = parseAIResponse(text);
  if (sections && sections.length > 1) {
    return (
      <div className="flex flex-col gap-3">
        {sections.map((sec, i) =>
          sec.title
            ? <SectionCard key={i} section={sec} />
            : sec.content
              ? <ProseBlock key={i} text={sec.content} />
              : null
        )}
      </div>
    );
  }
  return <ProseBlock text={text} />;
});

const RIPCopy = React.memo(function RIPCopy({ rip }: { rip: string }) {
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
});

const CopyButton = React.memo(function CopyButton({ text }: { text: string }) {
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
});

type UploadAccent = "indigo" | "violet";

const ACCENT_PALETTE: Record<UploadAccent, {
  label: string;
  iconBg: string;
  iconColor: string;
  borderIdle: string;
  borderHover: string;
  bgIdle: string;
  bgHover: string;
  ring: string;
  shadow: string;
}> = {
  indigo: {
    label: "text-indigo-700 dark:text-indigo-300",
    iconBg: "linear-gradient(135deg, #6366f1, #4f46e5)",
    iconColor: "#fff",
    borderIdle: "rgba(99,102,241,0.35)",
    borderHover: "rgba(99,102,241,0.70)",
    bgIdle: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(79,70,229,0.03))",
    bgHover: "linear-gradient(135deg, rgba(99,102,241,0.12), rgba(79,70,229,0.06))",
    ring: "rgba(99,102,241,0.18)",
    shadow: "0 4px 16px -6px rgba(99,102,241,0.30)",
  },
  violet: {
    label: "text-fuchsia-700 dark:text-fuchsia-300",
    iconBg: "linear-gradient(135deg, #c026d3, #9333ea)",
    iconColor: "#fff",
    borderIdle: "rgba(192,38,211,0.35)",
    borderHover: "rgba(192,38,211,0.70)",
    bgIdle: "linear-gradient(135deg, rgba(192,38,211,0.06), rgba(147,51,234,0.03))",
    bgHover: "linear-gradient(135deg, rgba(192,38,211,0.12), rgba(147,51,234,0.06))",
    ring: "rgba(192,38,211,0.18)",
    shadow: "0 4px 16px -6px rgba(192,38,211,0.30)",
  },
};

const MAX_IMAGES_PER_ZONE = 8;

type ImageUploadZoneProps = {
  label: string;
  icon: React.ReactNode;
  hint: string;
  files: File[];
  previewUrls: string[];
  onFilesAdd: (files: File[]) => void;
  onRemoveAt: (index: number) => void;
  onClear: () => void;
  accent?: UploadAccent;
};

const ImageUploadZone = React.memo(function ImageUploadZone({ label, icon, hint, files, previewUrls, onFilesAdd, onRemoveAt, onClear, accent = "indigo" }: ImageUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const zoneRef = useRef<HTMLButtonElement>(null);
  const palette = ACCENT_PALETTE[accent];
  const [hover, setHover] = useState(false);
  const [dragging, setDragging] = useState(false);

  const hasFiles = files.length > 0;
  const remaining = MAX_IMAGES_PER_ZONE - files.length;

  useEffect(() => {
    if (!hasFiles && inputRef.current) {
      inputRef.current.value = "";
    }
  }, [hasFiles]);

  // ── سحب وإفلات (متعدّد) ─────────────────────────────────────────
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/"));
    if (dropped.length > 0) onFilesAdd(dropped);
  }, [onFilesAdd]);

  // ── لصق من الحافظة (يدعم لصق صور متعدّدة دفعة واحدة) ──────────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const pasted: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) pasted.push(f);
        }
      }
      if (pasted.length > 0) {
        e.preventDefault();
        onFilesAdd(pasted);
      }
    };
    const node = zoneRef.current;
    node?.addEventListener("paste", handlePaste as EventListener);
    return () => node?.removeEventListener("paste", handlePaste as EventListener);
  }, [onFilesAdd]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).filter(f => f.type.startsWith("image/"));
    if (picked.length > 0) onFilesAdd(picked);
    e.target.value = "";
  };

  return (
    <div className="space-y-1.5">
      <label className={`text-xs font-bold flex items-center gap-1.5 ${palette.label}`}>
        {icon}
        {label}
        {hasFiles && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full mr-auto"
            style={{ background: palette.bgIdle, color: palette.iconColor, border: `1px solid ${palette.borderIdle}` }}
            data-testid={`image-count-${accent}`}
          >
            {files.length}/{MAX_IMAGES_PER_ZONE}
          </span>
        )}
      </label>
      <input
        type="file"
        ref={inputRef}
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />
      {!hasFiles ? (
        <button
          ref={zoneRef}
          type="button"
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
          className="w-full transition-all rounded-2xl p-4 flex flex-col items-center gap-1.5 group focus:outline-none"
          style={{
            background: dragging || hover ? palette.bgHover : palette.bgIdle,
            border: `2px dashed ${dragging || hover ? palette.borderHover : palette.borderIdle}`,
            boxShadow: dragging || hover ? palette.shadow : `inset 0 0 0 1px ${palette.ring}`,
            transform: dragging ? "scale(1.01)" : "scale(1)",
          }}
        >
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform"
            style={{ background: palette.iconBg, boxShadow: palette.shadow }}
          >
            <Upload className="w-4 h-4" style={{ color: palette.iconColor }} />
          </div>
          <span className="text-xs font-bold text-foreground">
            {dragging ? "أفلت الصور هنا" : "اختر صورة أو عدة صور، التقطها، أو الصقها"}
          </span>
          <span className="text-[11px] text-muted-foreground">{hint} · حتى {MAX_IMAGES_PER_ZONE} صور · JPG, PNG, WEBP, HEIC</span>
        </button>
      ) : (
        <div
          ref={zoneRef as unknown as React.RefObject<HTMLDivElement>}
          tabIndex={-1}
          onDrop={handleDrop}
          onDragEnter={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
          className="rounded-2xl p-2 transition-all"
          style={{
            border: `2px dashed ${dragging ? palette.borderHover : palette.borderIdle}`,
            background: dragging ? palette.bgHover : palette.bgIdle,
            boxShadow: `inset 0 0 0 1px ${palette.ring}`,
          }}
        >
          <div className="grid grid-cols-3 gap-2">
            {previewUrls.map((url, idx) => (
              <div
                key={`${url}-${idx}`}
                className="relative rounded-xl overflow-hidden group aspect-square"
                style={{ border: `1.5px solid ${palette.borderIdle}`, background: "hsl(var(--muted)/0.3)" }}
                data-testid={`preview-${accent}-${idx}`}
              >
                <img src={url} alt={`صورة ${idx + 1}`} className="w-full h-full object-cover" />
                <div
                  className="absolute top-1 right-1 bg-background/85 text-foreground text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center"
                  style={{ border: `1px solid ${palette.borderIdle}` }}
                >
                  {idx + 1}
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveAt(idx)}
                  className="absolute top-1 left-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:scale-110 shadow-md"
                  aria-label={`حذف الصورة ${idx + 1}`}
                  data-testid={`remove-${accent}-${idx}`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="aspect-square rounded-xl flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-all hover:scale-[1.02]"
                style={{
                  border: `2px dashed ${palette.borderIdle}`,
                  background: palette.bgHover,
                  color: palette.iconColor,
                }}
                data-testid={`add-more-${accent}`}
              >
                <Upload className="w-4 h-4" />
                <span>إضافة</span>
                <span className="text-[9px] opacity-70">{remaining} متبقّية</span>
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2 px-1">
            <span className="text-[11px] text-muted-foreground">
              {files.length === 1 ? "صورة واحدة" : `${files.length} صور — تُرسَل بالترتيب`}
            </span>
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] font-bold text-destructive hover:underline"
              data-testid={`clear-all-${accent}`}
            >
              مسح الكل
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

export default function Dashboard() {
  const { logout, user, token: authToken, updateUser } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistoryFromStorage(user?.username));
  const historyRef = useRef<HistoryItem[]>([]);
  const [selectedShoba, setSelectedShoba] = useState(SHOBAS[0]);

  const [exerciseFiles, setExerciseFiles] = useState<File[]>([]);
  const [exercisePreviewUrls, setExercisePreviewUrls] = useState<string[]>([]);

  const [attemptFiles, setAttemptFiles] = useState<File[]>([]);
  const [attemptPreviewUrls, setAttemptPreviewUrls] = useState<string[]>([]);

  const [solveMode, setSolveMode] = useState(false);
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
  const [xp, setXp] = useState(() => parseInt(localStorage.getItem(XP_KEY) || "0", 10));
  const [streak, setStreak] = useState(() => parseInt(localStorage.getItem(STREAK_KEY) || "0", 10));

  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const boardRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const pendingTextRef = useRef<string>("");
  const { isDark, toggle } = useDarkModeToggle();
  const calcCountdown = () => {
    const now = new Date();
    const diff = BAC_DATE.getTime() - now.getTime();
    if (diff <= 0) return { d: 0, h: 0, m: 0, s: 0 };
    const totalSecs = Math.floor(diff / 1000);
    return {
      d: Math.floor(totalSecs / 86400),
      h: Math.floor((totalSecs % 86400) / 3600),
      m: Math.floor((totalSecs % 3600) / 60),
      s: totalSecs % 60,
    };
  };
  const [countdown, setCountdown] = useState(calcCountdown);
  useEffect(() => {
    const id = setInterval(() => setCountdown(calcCountdown()), 1000);
    return () => clearInterval(id);
  }, []);
  const daysLeft = countdown.d;
  const trialRemaining = Math.max(0, TRIAL_MAX - trialUsed);
  const isActivated = user?.activated === true;
  const trialExpired = !isActivated && trialUsed >= TRIAL_MAX;

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // ── حفظ السجل في التخزين المحلي عند كل تغيير ─────────────────────
  useEffect(() => {
    saveHistoryToStorage(user?.username, history);
  }, [history, user?.username]);

  // ── إعادة تحميل السجل عند تغيّر المستخدم (تسجيل دخول حساب آخر) ──
  useEffect(() => {
    setHistory(loadHistoryFromStorage(user?.username));
  }, [user?.username]);

  useEffect(() => {
    return () => {
      historyRef.current.forEach(item => {
        if (item.exercisePreview?.startsWith("blob:")) URL.revokeObjectURL(item.exercisePreview);
        if (item.attemptPreview?.startsWith("blob:")) URL.revokeObjectURL(item.attemptPreview);
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      exercisePreviewUrls.forEach(u => URL.revokeObjectURL(u));
      attemptPreviewUrls.forEach(u => URL.revokeObjectURL(u));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // ── إضافة صور التمرين (مع احترام الحد الأقصى) ───────────────────
  const addExerciseFiles = useCallback((added: File[]) => {
    setExerciseFiles(prev => {
      const room = MAX_IMAGES_PER_ZONE - prev.length;
      if (room <= 0) return prev;
      const accepted = added.slice(0, room);
      setExercisePreviewUrls(urls => [...urls, ...accepted.map(f => URL.createObjectURL(f))]);
      return [...prev, ...accepted];
    });
  }, []);
  const removeExerciseAt = useCallback((idx: number) => {
    setExerciseFiles(prev => prev.filter((_, i) => i !== idx));
    setExercisePreviewUrls(prev => {
      const url = prev[idx];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);
  const clearExercise = useCallback(() => {
    setExerciseFiles([]);
    setExercisePreviewUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
  }, []);

  const addAttemptFiles = useCallback((added: File[]) => {
    setAttemptFiles(prev => {
      const room = MAX_IMAGES_PER_ZONE - prev.length;
      if (room <= 0) return prev;
      const accepted = added.slice(0, room);
      setAttemptPreviewUrls(urls => [...urls, ...accepted.map(f => URL.createObjectURL(f))]);
      return [...prev, ...accepted];
    });
  }, []);
  const removeAttemptAt = useCallback((idx: number) => {
    setAttemptFiles(prev => prev.filter((_, i) => i !== idx));
    setAttemptPreviewUrls(prev => {
      const url = prev[idx];
      if (url) URL.revokeObjectURL(url);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);
  const clearAttempt = useCallback(() => {
    setAttemptFiles([]);
    setAttemptPreviewUrls(prev => { prev.forEach(u => URL.revokeObjectURL(u)); return []; });
  }, []);

  const handleClearHistory = () => {
    if (confirm("هل أنت متأكد من مسح جميع التقييمات؟")) {
      setHistory(prev => {
        prev.forEach(item => {
          if (item.exercisePreview?.startsWith("blob:")) URL.revokeObjectURL(item.exercisePreview);
          if (item.attemptPreview?.startsWith("blob:"))  URL.revokeObjectURL(item.attemptPreview);
        });
        try { localStorage.removeItem(historyKeyFor(user?.username)); } catch {}
        return [];
      });
      toast({ title: "تم مسح السبورة بنجاح" });
    }
  };

  const handleLogout = () => { logout(); setLocation("/login"); };

  const handleActivateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!authToken || authToken === "trial") {
      toast({ title: "سجّل الدخول أولاً", description: "أنشئ حساباً ثم افتح نافذة التفعيل", variant: "destructive" });
      return;
    }
    // انتظر تحقق الخادم أولاً قبل التفعيل المحلي
    setIsUploading(true);
    try {
      const form = new FormData();
      form.append("receipt", file);
      form.append("paymentMethod", "baridimob");
      const res = await fetch("/api/auth/activate", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}` },
        body: form,
      });
      const data = await res.json();
      if (res.ok) {
        updateUser(data.token, data.user);
        setPayUploaded(true);
        toast({ title: "🎉 تم تفعيل حسابك!", description: "مبروك! يمكنك الآن الاستخدام غير المحدود." });
      } else {
        toast({ title: "❌ لم يُقبل الوصل", description: data.error ?? "حدث خطأ غير متوقع", variant: "destructive" });
        // إعادة تعيين حقل الملف
        e.target.value = "";
      }
    } catch {
      toast({ title: "خطأ في الاتصال", description: "تحقق من اتصالك بالإنترنت وحاول مجدداً", variant: "destructive" });
      e.target.value = "";
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (isPending) return; // حماية من النقر المزدوج أو سباق التشغيل التلقائي
    if (!isActivated && trialExpired) {
      setShowPayment(true);
      return;
    }
    if (exerciseFiles.length === 0) {
      toast({ title: "ارفع صورة التمرين أولاً!", variant: "destructive" });
      return;
    }
    if (!solveMode && attemptFiles.length === 0) {
      toast({ title: "ارفع صورة محاولتك أولاً!", variant: "destructive" });
      return;
    }

    setIsPending(true);
    setStreamingText("");

    // ── إنشاء صور مصغّرة دائمة (data URLs) لحفظها في السجل ─────────
    // (نأخذ أول صورة من كل مجموعة فقط — تكفي كملخّص بصري للسجل)
    const firstExercise = exerciseFiles[0] ?? null;
    const firstAttempt  = attemptFiles[0]  ?? null;
    const thumbnailsPromise = Promise.all([
      fileToThumbnailDataUrl(firstExercise),
      fileToThumbnailDataUrl(firstAttempt),
    ]);

    try {
      // ── ضغط جميع الصور بالتوازي (صور الهاتف قد تصل 8MB لكل واحدة) ──
      const [compressedExercises, compressedAttempts] = await Promise.all([
        Promise.all(exerciseFiles.map(f => compressImage(f).catch(() => f))),
        solveMode ? Promise.resolve([] as File[]) : Promise.all(attemptFiles.map(f => compressImage(f).catch(() => f))),
      ]);

      const formData = new FormData();
      for (const f of compressedExercises) formData.append("exercise", f);
      for (const f of compressedAttempts)  formData.append("attempt",  f);
      formData.append("shoba", selectedShoba);
      formData.append("notes", notes);
      formData.append("mode", solveMode ? "solve" : "correct");

      formData.append("deviceId", getDeviceId());

      const response = await fetch("/api/correct", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken ?? ""}` },
        body: formData,
      });

      if (!response.ok) {
        let err: { code?: string; error?: string } = {};
        try {
          err = await response.json();
        } catch {
          // الخادم أعاد ردّاً غير قابل للتحليل (HTML أو فارغ)
          if (response.status === 413) throw new Error("الصورة كبيرة جداً — حاول مرة أخرى (سيتم ضغطها تلقائياً)");
          if (response.status === 429) throw new Error("طلبات كثيرة — انتظر دقيقة ثم أعد المحاولة");
          if (response.status === 503 || response.status === 502) throw new Error("الخادم مشغول — حاول مجدداً بعد لحظة");
          throw new Error(`خطأ في الخادم (${response.status}) — حاول مجدداً`);
        }
        if (err.code === "TRIAL_EXHAUSTED") {
          setTrialUsed(TRIAL_MAX);
          localStorage.setItem(TRIAL_KEY, String(TRIAL_MAX));
          setShowPayment(true);
          return;
        }
        throw new Error(err.error || `خطأ ${response.status} — حاول مجدداً`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("لا يمكن قراءة الاستجابة");

      const decoder = new TextDecoder();
      let fullText = "";
      let lineBuffer = "";   // يحتفظ بالسطر الناقص بين الـ chunks

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // نُضيف الـ chunk للـ buffer ونُقسّم على السطور الكاملة فقط
        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? ""; // نُبقي السطر الأخير (قد يكون ناقصاً)

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
                  if (window.innerWidth < 768) {
                    boardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
                  }
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
            const [exerciseThumb, attemptThumb] = await thumbnailsPromise;
            setHistory(prev => [{
              id,
              evaluation: fullText,
              date: new Date(),
              shoba: selectedShoba,
              exercisePreview: exerciseThumb,
              attemptPreview: attemptThumb,
            }, ...prev].slice(0, MAX_HISTORY_ITEMS));
            setStreamingText("");
            clearExercise();
            clearAttempt();
            setNotes("");

            // ── تحديث XP والاستمرارية ──
            const result = parseResultBlock(fullText);
            if (result) {
              setXp(prev => {
                const next = prev + result.xpGain;
                localStorage.setItem(XP_KEY, String(next));
                return next;
              });
              setStreak(prev => {
                const next = result.streakGain > 0 ? prev + 1 : 0;
                localStorage.setItem(STREAK_KEY, String(next));
                return next;
              });
            }

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
              toast({ title: "✅ اكتمل التصحيح!", description: result ? `+${result.xpGain} XP 🔥` : "تصحيحات غير محدودة — استمر!" });
            }
          }
        }
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : "";
      const isNetworkErr =
        raw === "Failed to fetch" ||
        raw.includes("NetworkError") ||
        raw.includes("network") ||
        raw.includes("fetch");
      const msg = isNetworkErr
        ? "انقطع الاتصال أثناء التصحيح — تحقق من الإنترنت وأعد المحاولة"
        : raw || "حدث خطأ أثناء التقييم";
      toast({ title: "خطأ في التقييم", description: msg, variant: "destructive" });
      setStreamingText("");
    } finally {
      setIsPending(false);
    }
  };

  const canSubmit = exerciseFiles.length > 0 && (solveMode || attemptFiles.length > 0) && (isActivated || !trialExpired);

  // ── التصحيح التلقائي: ينطلق فور توفر كل الصور المطلوبة ──
  // تأخير 2.5ث ليتمكّن الطالب من إضافة صور إضافية أو استبدالها
  const handleSubmitRef = useRef(handleSubmit);
  useEffect(() => { handleSubmitRef.current = handleSubmit; });
  const [autoSubmitPending, setAutoSubmitPending] = useState(false);
  useEffect(() => {
    if (isPending) { setAutoSubmitPending(false); return; }
    if (!canSubmit) { setAutoSubmitPending(false); return; }
    setAutoSubmitPending(true);
    const t = setTimeout(() => {
      setAutoSubmitPending(false);
      handleSubmitRef.current();
    }, 2500);
    // لا نعيد ضبط autoSubmitPending هنا لتجنّب ومضة UI عند إضافة المزيد من الصور
    return () => { clearTimeout(t); };
    // نراقب المصفوفات نفسها (لا الطول فقط) حتى نلتقط استبدال الملفات
  }, [exerciseFiles, attemptFiles, solveMode, isPending, canSubmit]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col relative overflow-x-hidden">
      <div className="flex flex-col md:flex-row flex-1 min-h-0 md:overflow-hidden" style={{ minHeight: "100dvh" }}>
      {/* SIDEBAR */}
      <aside className="w-full md:w-80 lg:w-96 bg-card border-l border-border/60 flex flex-col shrink-0 overflow-y-auto" style={{ boxShadow: "4px 0 40px -8px hsl(var(--primary)/0.18), 0 0 0 1px hsl(var(--border)/0.8)", paddingBottom: "calc(4rem + var(--safe-bottom))" }}>
        <div className="p-6 flex-1 flex flex-col gap-5">
          {/* Header */}
          <div
            className="flex items-center justify-between rounded-2xl px-4 py-3 -mx-1"
            style={{
              background: "linear-gradient(135deg, rgba(99,102,241,0.10) 0%, rgba(139,92,246,0.05) 60%, transparent 100%)",
              border: "1px solid rgba(99,102,241,0.15)",
            }}
          >
            <div>
              <div className="flex items-center gap-2.5">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", boxShadow: "0 4px 14px rgba(99,102,241,0.45)" }}
                >
                  <span className="text-base font-black text-white" style={{ fontFamily: "serif" }}>Σ</span>
                </div>
                <div>
                  <h2 className="text-sm font-black leading-tight" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>سِيغْمَا</h2>
                  <p className="text-[10px] text-muted-foreground leading-tight">مصحح الرياضيات · بكالوريا 2026</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
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

          {/* ── عداد البكالوريا ─────────────────────────────────────── */}
          <div
            className="rounded-2xl p-4"
            style={{
              background: "linear-gradient(135deg, #3b5bdb 0%, #4c6ef5 60%, #748ffc 100%)",
              boxShadow: "0 8px 32px -8px rgba(59,91,219,0.55)",
            }}
          >
            {/* رأس العداد */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({ title: "سِيغْمَا — مصحح الباك", text: `باقي ${daysLeft} يوم للبكالوريا! جرب التطبيق 👇`, url: window.location.origin });
                  } else {
                    navigator.clipboard.writeText(window.location.origin);
                    toast({ title: "تم نسخ الرابط", description: window.location.origin });
                  }
                }}
                className="w-9 h-9 rounded-full flex items-center justify-center bg-white/20 hover:bg-white/30 transition-colors"
                aria-label="مشاركة"
              >
                <Share2 className="w-4 h-4 text-white" />
              </button>
              <div className="flex items-center gap-2">
                <span className="text-white font-bold text-sm">العد التنازلي للبكالوريا</span>
                <span className="text-lg">🕐</span>
              </div>
            </div>

            {/* مربعات الأرقام */}
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[
                { label: "يوم", value: countdown.d },
                { label: "ساعة", value: countdown.h },
                { label: "دقيقة", value: countdown.m },
                { label: "ثانية", value: countdown.s },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center">
                  <div
                    className="w-full rounded-xl flex items-center justify-center py-2.5"
                    style={{ background: "rgba(255,255,255,0.18)", backdropFilter: "blur(4px)" }}
                  >
                    <span className="text-2xl font-black text-white tabular-nums leading-none">
                      {String(value).padStart(2, "0")}
                    </span>
                  </div>
                  <span className="text-[11px] text-white/80 mt-1 font-medium">{label}</span>
                </div>
              ))}
            </div>

            {/* شريط التشجيع */}
            <div
              className="rounded-xl px-3 py-2 flex items-center justify-center gap-2"
              style={{ background: "rgba(255,255,255,0.15)" }}
            >
              <span className="text-[12px] text-white font-semibold text-center">
                🏆 باقي {daysLeft} يوم — كل يوم يقربك من النجاح!
              </span>
            </div>
          </div>

          {/* XP + Streak widget */}
          <XpStreakWidget xp={xp} streak={streak} />

          {/* Account Status Badge */}
          {isActivated ? (
            <div
              className="rounded-2xl px-4 py-3 flex items-center gap-3"
              style={{
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a78bfa 100%)",
                boxShadow: "0 8px 32px -8px rgba(99,102,241,0.55)",
              }}
            >
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.20)" }}>
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-black text-white leading-tight">حساب مفعّل ✨</p>
                <p className="text-xs text-white/75 leading-tight">تصحيحات غير محدودة — سنة كاملة</p>
              </div>
            </div>
          ) : !trialExpired ? (
            <div
              className="rounded-2xl px-4 py-3 space-y-2.5"
              style={{
                background: "linear-gradient(135deg, #16a34a 0%, #22c55e 60%, #4ade80 100%)",
                boxShadow: "0 8px 32px -8px rgba(22,163,74,0.55)",
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.20)" }}>
                  <span className="text-base">🎁</span>
                </div>
                <div>
                  <p className="text-sm font-black text-white leading-tight">نسخة تجريبية مجانية</p>
                  <p className="text-xs text-white/80 leading-tight">
                    باقي <span className="font-black">{trialRemaining}</span> من {TRIAL_MAX} استخدامات
                  </p>
                </div>
                <button
                  onClick={() => setShowPayment(true)}
                  className="mr-auto text-xs font-bold px-2.5 py-1 rounded-lg transition-all hover:-translate-y-px"
                  style={{ background: "rgba(255,255,255,0.25)", color: "#fff", border: "1px solid rgba(255,255,255,0.35)" }}
                >
                  فعّل ↑
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                {Array.from({ length: TRIAL_MAX }).map((_, i) => (
                  <div key={i} className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.25)" }}>
                    <div
                      className="h-full w-full rounded-full"
                      style={i < trialUsed
                        ? { background: "rgba(239,68,68,0.9)" }
                        : { background: "rgba(255,255,255,0.6)" }}
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-center text-white/80">
                {trialUsed === 0 ? "استمتع بـ 3 تصحيحات مجانية 🎉" : `استعملت ${trialUsed} من ${TRIAL_MAX} — باقي ${trialRemaining}`}
              </p>
            </div>
          ) : (
            <div
              className="rounded-2xl px-4 py-3.5 space-y-2.5"
              style={{
                background: "linear-gradient(135deg, #dc2626 0%, #ef4444 60%, #f87171 100%)",
                boxShadow: "0 8px 32px -8px rgba(220,38,38,0.55)",
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.20)" }}>
                  <span className="text-base">🔒</span>
                </div>
                <div>
                  <p className="text-sm font-black text-white leading-tight">انتهت النسخة التجريبية</p>
                  <p className="text-xs text-white/80 leading-tight">استنفدت الـ {TRIAL_MAX} تصحيحات المجانية</p>
                </div>
              </div>
              <div className="flex gap-1.5">
                {Array.from({ length: TRIAL_MAX }).map((_, i) => (
                  <div key={i} className="flex-1 h-2 rounded-full" style={{ background: "rgba(255,255,255,0.35)" }} />
                ))}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/60 line-through">1000 دج</span>
                  <span className="font-black text-white">500 دج — عرض سنوي</span>
                </div>
                <button
                  onClick={() => setShowPayment(true)}
                  className="w-full text-xs font-black text-white rounded-xl py-2 transition-all duration-150 hover:-translate-y-px"
                  style={{ background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.35)" }}
                >
                  🔓 فعّل الآن بـ 500 دج
                </button>
              </div>
            </div>
          )}

          {/* فاصل أنيق */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border/60" />
            <span className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest select-none">إعدادات</span>
            <div className="flex-1 h-px bg-border/60" />
          </div>

          {/* Shoba */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">شعبتك في البكالوريا</label>
            <div className="relative">
              <select
                value={selectedShoba}
                onChange={(e) => setSelectedShoba(e.target.value)}
                className="w-full appearance-none bg-card border border-border/80 hover:border-primary/50 rounded-xl px-4 py-2.5 text-sm text-foreground font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
                style={{ boxShadow: "0 1px 4px -1px rgba(0,0,0,0.06)" }}
              >
                {SHOBAS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <ChevronDown className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-xl border border-border/70" style={{ background: "hsl(var(--muted)/0.4)" }}>
            <button
              onClick={() => setSolveMode(false)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-bold transition-all duration-200"
              style={!solveMode ? {
                background: "hsl(var(--card))",
                color: "hsl(var(--foreground))",
                boxShadow: "0 1px 6px -1px rgba(0,0,0,0.10), 0 0 0 1px hsl(var(--border)/0.6)",
              } : { color: "hsl(var(--muted-foreground))" }}
            >
              <PenLine className="w-3.5 h-3.5" />
              صحّح محاولتي
            </button>
            <button
              onClick={() => { setSolveMode(true); clearAttempt(); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg text-xs font-bold transition-all duration-200"
              style={solveMode ? {
                background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
                color: "#fff",
                boxShadow: "0 2px 10px -2px rgba(99,102,241,0.50)",
              } : { color: "hsl(var(--muted-foreground))" }}
            >
              <Sparkles className="w-3.5 h-3.5" />
              الحل الكامل
            </button>
          </div>

          {/* Exercise Upload — يدعم عدة صور للتمارين الموزّعة على عدة أوراق */}
          <ImageUploadZone
            label="صور التمرين"
            icon={<FileText className="w-3.5 h-3.5" />}
            hint="نص السؤال / الوثيقة"
            files={exerciseFiles}
            previewUrls={exercisePreviewUrls}
            onFilesAdd={addExerciseFiles}
            onRemoveAt={removeExerciseAt}
            onClear={clearExercise}
            accent="indigo"
          />

          {/* Attempt Upload — يدعم عدة صور للحلول الطويلة */}
          {!solveMode && (
            <ImageUploadZone
              label="صور محاولتك"
              icon={<PenLine className="w-3.5 h-3.5" />}
              hint="ما كتبته بخط يدك"
              files={attemptFiles}
              previewUrls={attemptPreviewUrls}
              onFilesAdd={addAttemptFiles}
              onRemoveAt={removeAttemptAt}
              onClear={clearAttempt}
              accent="violet"
            />
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold flex items-center gap-1.5 text-indigo-700 dark:text-indigo-300">
              <MessageSquare className="w-3.5 h-3.5" />
              قل للأستاذ
              <span className="text-[11px] text-muted-foreground font-normal mr-auto">اختياري</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="مثلاً: ما فهمتش السؤال الثاني..."
              className="w-full rounded-2xl px-4 py-3 text-sm focus:outline-none transition-all resize-none min-h-[70px] placeholder:text-muted-foreground/60 text-foreground"
              style={{
                background: "linear-gradient(135deg, rgba(99,102,241,0.06), rgba(79,70,229,0.03))",
                border: "2px dashed rgba(99,102,241,0.35)",
                boxShadow: "inset 0 0 0 1px rgba(99,102,241,0.18)",
              }}
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
                  <span className="text-yellow-200">{solveMode ? "جاري بناء الحل..." : "جاري التصحيح..."}</span>
                </>
              ) : autoSubmitPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-yellow-300 border-t-transparent rounded-full animate-spin" />
                  <span className="text-yellow-200">سيبدأ التصحيح تلقائياً...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-yellow-300 drop-shadow-[0_0_6px_rgba(253,224,71,0.8)]" />
                  <span
                    className={solveMode
                      ? "text-yellow-300 drop-shadow-[0_0_8px_rgba(253,224,71,0.7)]"
                      : "text-orange-400 drop-shadow-[0_0_8px_rgba(251,146,60,0.8)]"}
                  >
                    {solveMode ? "احصل على الحل الكامل" : "قيّم محاولتي"}
                  </span>
                </>
              )}
            </button>
            {autoSubmitPending && !isPending && (
              <p className="text-center text-[11px] text-yellow-600 dark:text-yellow-400 mt-2 animate-pulse">
                ✨ يمكنك إضافة المزيد من الصور أو سيبدأ التصحيح خلال لحظات
              </p>
            )}
            {!canSubmit && !autoSubmitPending && (
              <p className="text-center text-xs text-muted-foreground mt-2">
                {trialExpired
                  ? <button onClick={() => setShowPayment(true)} className="text-primary font-bold hover:underline">فعّل حسابك (500 دج) للاستمرار ←</button>
                  : exerciseFiles.length === 0
                    ? "ارفع صورة التمرين"
                    : !solveMode ? "ارفع صورة محاولتك" : ""}
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main ref={boardRef} className="flex-1 p-6 overflow-y-auto" style={{
        paddingBottom: "calc(5rem + var(--safe-bottom))",
        background: "linear-gradient(135deg, hsl(var(--muted)/0.4), hsl(var(--background)))",
      }}>
        <div className="max-w-3xl mx-auto">
          {/* Heading */}
          <div className="flex items-center justify-between mb-6">
            <h1
              className="text-xl font-black"
              style={{ background: "linear-gradient(135deg, hsl(var(--foreground)) 30%, hsl(var(--primary)))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}
            >السبورة الإلكترونية</h1>
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

          {/* بطاقة التفكير — تظهر فور الإرسال حتى يبدأ النص */}
          <AnimatePresence>
            {isPending && !streamingText && (
              <motion.div
                key="thinking"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="rounded-2xl p-6 mb-4"
                style={{ background: "linear-gradient(135deg, hsl(var(--card)) 60%, hsl(var(--primary)/0.05))", border: "1.5px solid hsl(var(--primary)/0.22)", boxShadow: "0 4px 24px -6px hsl(var(--primary)/0.20)" }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-sm font-semibold text-primary">
                    Σ سِيغْمَا {solveMode ? "يحلّل التمرين ويبني الحل..." : "يفكّر في إجابتك..."}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-2 mr-7">
                  قد يستغرق التفكير العميق بضع ثوانٍ — انتظر قليلاً
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Streaming Result */}
          <AnimatePresence>
            {streamingText && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl p-6 mb-4"
                style={{ background: "linear-gradient(135deg, hsl(var(--card)) 50%, hsl(var(--primary)/0.06))", border: "1.5px solid hsl(var(--primary)/0.30)", boxShadow: "0 6px 30px -8px hsl(var(--primary)/0.25)" }}
              >
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="text-xs font-semibold text-primary">
                    Σ سِيغْمَا {solveMode ? "يبني الحل الكامل..." : "يقيّم محاولتك..."}
                  </span>
                  <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs font-bold px-2.5 py-0.5 rounded-full mr-auto">
                    <Sparkles className="w-3 h-3" />
                    {selectedShoba}
                  </span>
                </div>
                <MarkdownResult text={streamingText} />
                {!isPending && <DailyVerse />}
              </motion.div>
            )}
          </AnimatePresence>

          {/* History */}
          {!streamingText && history.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-center">
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center mb-5"
                style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.14), rgba(139,92,246,0.07))",
                  border: "1.5px solid rgba(99,102,241,0.18)",
                  boxShadow: "0 0 40px -8px rgba(99,102,241,0.30), 0 4px 16px -4px rgba(99,102,241,0.15)",
                }}
              >
                <MessageSquare className="w-10 h-10" style={{ color: "rgba(99,102,241,0.55)" }} />
              </div>
              <h3 className="text-base font-bold text-foreground mb-2">السبورة فارغة</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {solveMode
                  ? "ارفع صورة التمرين وسيبني سِيغْمَا الحل الكامل لك فوراً"
                  : "ارفع صورة التمرين وصورة محاولتك وسيقيّم سِيغْمَا إجابتك فوراً"}
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
                    className="rounded-2xl overflow-hidden"
                    style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border)/0.6)", boxShadow: "0 4px 24px -6px rgba(99,102,241,0.12), 0 1px 4px -2px rgba(0,0,0,0.06)" }}
                  >
                    <div
                      className="flex items-center justify-between px-6 pt-4 pb-3 border-b border-border/50"
                      style={{ background: "linear-gradient(to left, rgba(99,102,241,0.06), rgba(139,92,246,0.03), transparent)" }}
                    >
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
                        <MarkdownResult text={item.evaluation} />
                        <DailyVerse />
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
                            <input type="file" accept="image/png,image/jpeg,image/jpg,image/webp,image/heic,image/heif" className="hidden" onChange={handleActivateUpload} disabled={isUploading} />
                            {isUploading ? (
                              <>
                                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                <span className="text-sm font-semibold text-primary">جاري التحقق من الوصل...</span>
                              </>
                            ) : (
                              <>
                                <div className="w-10 h-10 rounded-full bg-primary/8 border border-primary/20 flex items-center justify-center">
                                  <Upload className="w-4 h-4 text-primary" />
                                </div>
                                <div className="text-center">
                                  <p className="text-sm font-semibold text-foreground">اختر صورة وصل بريدي موب</p>
                                  <p className="text-xs text-muted-foreground mt-0.5">وصل بريد الجزائر أو بريدي موب — التفعيل فوري</p>
                                </div>
                              </>
                            )}
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

      {/* Footer */}
      <footer className="border-t border-border bg-card py-2">
        <div className="flex items-center justify-center gap-3 px-4 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)" }}>
              <span className="text-xs font-black text-white" style={{ fontFamily: "serif" }}>Σ</span>
            </div>
            <span className="text-xs text-muted-foreground">SIGMA © 2026 — Tous droits réservés</span>
          </div>
          <span className="text-muted-foreground/40 text-xs hidden sm:inline">|</span>
          <a
            href="/privacy"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Politique de confidentialité
          </a>
          <span className="text-muted-foreground/40 text-xs">|</span>
          <a
            href="/terms"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Conditions d'utilisation
          </a>
        </div>
      </footer>
    </div>
  );
}
