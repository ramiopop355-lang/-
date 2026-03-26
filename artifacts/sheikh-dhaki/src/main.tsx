import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// تثبيت PWA على Android فقط
const isAndroid = /android/i.test(navigator.userAgent);

window.addEventListener("beforeinstallprompt", (e) => {
  if (!isAndroid) {
    e.preventDefault();
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const base = import.meta.env.BASE_URL || "/";
    navigator.serviceWorker
      .register(`${base}progressier.js`)
      .catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);
