import { useEffect, useState } from "react";

export default function SplashScreen({ onDone }: { onDone: () => void }) {
  const [out, setOut] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setOut(true), 1600);
    const t2 = setTimeout(onDone, 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "20px",
        background: "linear-gradient(135deg, #0f0f1a 0%, #1a1040 50%, #0f0f1a 100%)",
        opacity: out ? 0 : 1,
        transition: "opacity 0.4s ease",
        pointerEvents: out ? "none" : "all",
      }}
    >
      <style>{`
        @keyframes sigma-pop {
          0%   { transform: scale(0.5) rotate(-10deg); opacity: 0; }
          60%  { transform: scale(1.1) rotate(2deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes sigma-glow {
          0%, 100% { box-shadow: 0 0 30px rgba(99,102,241,0.5), 0 0 60px rgba(139,92,246,0.3); }
          50%       { box-shadow: 0 0 50px rgba(99,102,241,0.8), 0 0 100px rgba(139,92,246,0.5); }
        }
        @keyframes text-rise {
          0%   { transform: translateY(16px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes sub-rise {
          0%   { transform: translateY(10px); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes bar-fill {
          0%   { width: 0%; }
          100% { width: 100%; }
        }
      `}</style>

      {/* الشعار */}
      <div style={{
        width: 88,
        height: 88,
        borderRadius: 24,
        background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        animation: "sigma-pop 0.6s cubic-bezier(0.34,1.56,0.64,1) forwards, sigma-glow 2s ease-in-out 0.6s infinite",
      }}>
        <span style={{
          fontSize: 44,
          fontWeight: 900,
          color: "white",
          fontFamily: "serif",
          lineHeight: 1,
        }}>Σ</span>
      </div>

      {/* الاسم */}
      <div style={{ textAlign: "center", direction: "rtl" }}>
        <div style={{
          fontSize: 36,
          fontWeight: 900,
          color: "white",
          fontFamily: "'Cairo', sans-serif",
          animation: "text-rise 0.5s ease 0.5s both",
          letterSpacing: "-0.5px",
        }}>سِيغْمَا</div>
        <div style={{
          fontSize: 13,
          color: "rgba(167,139,250,0.85)",
          fontFamily: "'Cairo', sans-serif",
          marginTop: 4,
          animation: "sub-rise 0.5s ease 0.7s both",
        }}>مصحح رياضيات البكالوريا بالذكاء الاصطناعي</div>
      </div>

      {/* شريط تحميل */}
      <div style={{
        width: 160,
        height: 3,
        borderRadius: 99,
        background: "rgba(255,255,255,0.1)",
        overflow: "hidden",
        marginTop: 8,
        animation: "sub-rise 0.4s ease 0.9s both",
      }}>
        <div style={{
          height: "100%",
          background: "linear-gradient(90deg, #6366f1, #a78bfa)",
          borderRadius: 99,
          animation: "bar-fill 1.4s ease 0.9s both",
        }} />
      </div>
    </div>
  );
}
