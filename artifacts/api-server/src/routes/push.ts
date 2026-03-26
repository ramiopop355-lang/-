import { Router, type IRouter } from "express";
import webpush from "web-push";
import Database from "@replit/database";

const router: IRouter = Router();
const db = new Database();

webpush.setVapidDetails(
  process.env["VAPID_EMAIL"] ?? "mailto:sigma@bac.dz",
  process.env["VAPID_PUBLIC_KEY"] ?? "",
  process.env["VAPID_PRIVATE_KEY"] ?? ""
);

function subKey(username: string) {
  return `push:${username.toLowerCase().trim()}`;
}

// إرجاع المفتاح العام لـ VAPID
router.get("/api/push/vapid-public-key", (_req, res) => {
  res.json({ key: process.env["VAPID_PUBLIC_KEY"] ?? "" });
});

// حفظ اشتراك الإشعارات
router.post("/api/push/subscribe", async (req, res): Promise<void> => {
  const { username, subscription } = req.body as { username: string; subscription: webpush.PushSubscription };
  if (!username || !subscription) { res.status(400).json({ error: "missing fields" }); return; }
  await db.set(subKey(username), JSON.stringify(subscription));
  res.json({ ok: true });
});

// إلغاء الاشتراك
router.delete("/api/push/subscribe", async (req, res): Promise<void> => {
  const { username } = req.body as { username: string };
  if (!username) { res.status(400).json({ error: "missing username" }); return; }
  await db.delete(subKey(username));
  res.json({ ok: true });
});

// إرسال إشعار (داخلي — يُستخدم من routes أخرى لاحقاً)
export async function sendPush(username: string, title: string, body: string, url = "/") {
  const result = await db.get(subKey(username));
  if (!result.ok || !result.value) return;
  const sub: webpush.PushSubscription = typeof result.value === "string"
    ? JSON.parse(result.value)
    : result.value as webpush.PushSubscription;
  try {
    await webpush.sendNotification(sub, JSON.stringify({ title, body, url }));
  } catch (err: unknown) {
    const e = err as { statusCode?: number };
    if (e.statusCode === 410 || e.statusCode === 404) {
      await db.delete(subKey(username));
    }
  }
}

export default router;
