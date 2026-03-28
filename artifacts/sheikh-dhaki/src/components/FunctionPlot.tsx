import { useEffect, useRef, useMemo } from "react";
import { evaluate, parse } from "mathjs";

export interface PlotFunction {
  fn: string;
  label?: string;
  color?: string;
  dashed?: boolean;
}

export interface PlotSpec {
  functions: PlotFunction[];
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  title?: string;
  points?: { x: number; y: number; label?: string }[];
  asymptotes?: { type: "v" | "h"; value: number; label?: string }[];
}

const COLORS = ["#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#3b82f6", "#a855f7"];

function safeEval(fn: string, x: number): number | null {
  try {
    const result = evaluate(fn, { x, e: Math.E, pi: Math.PI });
    if (typeof result !== "number" || !isFinite(result)) return null;
    return result;
  } catch {
    return null;
  }
}

function parsePlotSpec(raw: string): PlotSpec | null {
  try {
    const spec = JSON.parse(raw.trim());
    if (!spec.functions && spec.fn) {
      spec.functions = [{ fn: spec.fn, label: spec.label, color: spec.color }];
    }
    if (!Array.isArray(spec.functions)) return null;
    return spec as PlotSpec;
  } catch {
    return null;
  }
}

export default function FunctionPlot({ raw }: { raw: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const spec = useMemo(() => parsePlotSpec(raw), [raw]);

  useEffect(() => {
    if (!spec || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const isDark = document.documentElement.classList.contains("dark");
    const bg = isDark ? "#1e1e2e" : "#ffffff";
    const gridColor = isDark ? "#2a2a3e" : "#e5e7eb";
    const axisColor = isDark ? "#6b7280" : "#374151";
    const labelColor = isDark ? "#9ca3af" : "#6b7280";
    const textColor = isDark ? "#e2e8f0" : "#111827";

    const xMin = spec.xMin ?? -5;
    const xMax = spec.xMax ?? 5;
    const SAMPLES = W * 2;

    // Compute y range from samples
    let yMin = spec.yMin ?? Infinity;
    let yMax = spec.yMax ?? -Infinity;
    if (spec.yMin === undefined || spec.yMax === undefined) {
      for (const f of spec.functions) {
        for (let i = 0; i <= SAMPLES; i++) {
          const x = xMin + (xMax - xMin) * (i / SAMPLES);
          const y = safeEval(f.fn, x);
          if (y !== null) {
            yMin = Math.min(yMin, y);
            yMax = Math.max(yMax, y);
          }
        }
      }
      // Add padding
      const pad = (yMax - yMin) * 0.15 || 1;
      yMin -= pad;
      yMax += pad;
    }
    if (!isFinite(yMin)) yMin = -5;
    if (!isFinite(yMax)) yMax = 5;

    const PAD = { top: 30, right: 20, bottom: 40, left: 50 };
    const pw = W - PAD.left - PAD.right;
    const ph = H - PAD.top - PAD.bottom;

    const toCanvasX = (x: number) => PAD.left + ((x - xMin) / (xMax - xMin)) * pw;
    const toCanvasY = (y: number) => PAD.top + ((yMax - y) / (yMax - yMin)) * ph;

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    const xStep = niceStep(xMax - xMin);
    const yStep = niceStep(yMax - yMin);

    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      ctx.beginPath();
      ctx.moveTo(toCanvasX(x), PAD.top);
      ctx.lineTo(toCanvasX(x), PAD.top + ph);
      ctx.stroke();
    }
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      ctx.beginPath();
      ctx.moveTo(PAD.left, toCanvasY(y));
      ctx.lineTo(PAD.left + pw, toCanvasY(y));
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1.5;
    // X axis (y=0)
    if (yMin <= 0 && 0 <= yMax) {
      const y0 = toCanvasY(0);
      ctx.beginPath();
      ctx.moveTo(PAD.left, y0);
      ctx.lineTo(PAD.left + pw, y0);
      ctx.stroke();
    }
    // Y axis (x=0)
    if (xMin <= 0 && 0 <= xMax) {
      const x0 = toCanvasX(0);
      ctx.beginPath();
      ctx.moveTo(x0, PAD.top);
      ctx.lineTo(x0, PAD.top + ph);
      ctx.stroke();
    }

    // Axis labels
    ctx.fillStyle = labelColor;
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "center";
    for (let x = Math.ceil(xMin / xStep) * xStep; x <= xMax; x += xStep) {
      if (Math.abs(x) < 1e-10) continue;
      const lbl = Number(x.toFixed(6)).toString();
      ctx.fillText(lbl, toCanvasX(x), PAD.top + ph + 18);
    }
    ctx.textAlign = "right";
    for (let y = Math.ceil(yMin / yStep) * yStep; y <= yMax; y += yStep) {
      if (Math.abs(y) < 1e-10) continue;
      const lbl = Number(y.toFixed(6)).toString();
      ctx.fillText(lbl, PAD.left - 6, toCanvasY(y) + 4);
    }

    // Asymptotes
    if (spec.asymptotes) {
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = isDark ? "#6b7280" : "#9ca3af";
      for (const a of spec.asymptotes) {
        ctx.beginPath();
        if (a.type === "v") {
          const ax = toCanvasX(a.value);
          ctx.moveTo(ax, PAD.top);
          ctx.lineTo(ax, PAD.top + ph);
        } else {
          const ay = toCanvasY(a.value);
          ctx.moveTo(PAD.left, ay);
          ctx.lineTo(PAD.left + pw, ay);
        }
        ctx.stroke();
        if (a.label) {
          ctx.fillStyle = labelColor;
          ctx.font = "10px Inter";
          ctx.textAlign = "left";
          const ax = a.type === "v" ? toCanvasX(a.value) + 4 : PAD.left + 4;
          const ay = a.type === "h" ? toCanvasY(a.value) - 4 : PAD.top + 14;
          ctx.fillText(a.label, ax, ay);
        }
      }
      ctx.setLineDash([]);
    }

    // Plot functions
    for (let fi = 0; fi < spec.functions.length; fi++) {
      const f = spec.functions[fi];
      const color = f.color ?? COLORS[fi % COLORS.length];
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.2;
      if (f.dashed) ctx.setLineDash([8, 4]);
      else ctx.setLineDash([]);

      ctx.beginPath();
      let started = false;
      let prevY: number | null = null;
      for (let i = 0; i <= SAMPLES; i++) {
        const x = xMin + (xMax - xMin) * (i / SAMPLES);
        const y = safeEval(f.fn, x);
        if (y === null || y < yMin - Math.abs(yMax - yMin) || y > yMax + Math.abs(yMax - yMin)) {
          started = false;
          prevY = null;
          continue;
        }
        // Discontinuity detection
        if (prevY !== null && Math.abs(y - prevY) > (yMax - yMin) * 1.5) {
          started = false;
        }
        const cx = toCanvasX(x);
        const cy = toCanvasY(y);
        if (!started) { ctx.moveTo(cx, cy); started = true; }
        else ctx.lineTo(cx, cy);
        prevY = y;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Special points
    if (spec.points) {
      for (const pt of spec.points) {
        const cx = toCanvasX(pt.x);
        const cy = toCanvasY(pt.y);
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fillStyle = isDark ? "#e2e8f0" : "#111827";
        ctx.fill();
        if (pt.label) {
          ctx.fillStyle = textColor;
          ctx.font = "11px Inter";
          ctx.textAlign = "left";
          ctx.fillText(pt.label, cx + 7, cy - 5);
        }
      }
    }

    // Legend
    if (spec.functions.some(f => f.label)) {
      let lx = PAD.left + 8;
      const ly = PAD.top + 8;
      for (let fi = 0; fi < spec.functions.length; fi++) {
        const f = spec.functions[fi];
        if (!f.label) continue;
        const color = f.color ?? COLORS[fi % COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.2;
        if (f.dashed) ctx.setLineDash([6, 3]);
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(lx + 22, ly);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = textColor;
        ctx.font = "11px Inter";
        ctx.textAlign = "left";
        ctx.fillText(f.label, lx + 26, ly + 4);
        lx += 26 + ctx.measureText(f.label).width + 16;
      }
    }

    // Title
    if (spec.title) {
      ctx.fillStyle = textColor;
      ctx.font = "bold 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(spec.title, W / 2, 18);
    }
  }, [spec]);

  if (!spec) {
    return (
      <div className="border border-border rounded-xl p-3 text-sm text-muted-foreground font-mono bg-muted">
        {raw}
      </div>
    );
  }

  return (
    <div className="my-4 rounded-2xl overflow-hidden border border-border shadow-sm bg-card">
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: 300, display: "block" }}
      />
    </div>
  );
}

function niceStep(range: number): number {
  const rough = range / 6;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  if (norm < 1.5) return mag;
  if (norm < 3.5) return 2 * mag;
  if (norm < 7.5) return 5 * mag;
  return 10 * mag;
}
