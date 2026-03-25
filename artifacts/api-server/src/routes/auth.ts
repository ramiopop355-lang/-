import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "@replit/database";

const router: IRouter = Router();
const db = new Database();

const JWT_SECRET = process.env["JWT_SECRET"] ?? "ustad-riyad-2026-secret-key";
const SALT_ROUNDS = 10;

interface User {
  username: string;
  phone: string;
  passwordHash: string;
  createdAt: string;
  activated: boolean;
}

function userKey(username: string) {
  return `user:${username.toLowerCase().trim()}`;
}

async function getUser(username: string): Promise<User | null> {
  const result = await db.get(userKey(username));
  if (!result.ok || !result.value) return null;
  const raw = result.value;
  return typeof raw === "string" ? JSON.parse(raw) : raw as User;
}

router.post("/auth/register", async (req, res) => {
  try {
    const { username, phone, password } = req.body as {
      username?: string;
      phone?: string;
      password?: string;
    };

    if (!username || !phone || !password) {
      return res.status(400).json({ error: "جميع الحقول مطلوبة (اسم المستخدم، الرقم، كلمة السر)" });
    }

    const cleanUsername = username.trim();
    const cleanPhone = phone.trim();

    if (cleanUsername.length < 3) {
      return res.status(400).json({ error: "اسم المستخدم يجب أن يكون 3 أحرف على الأقل" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "كلمة السر يجب أن تكون 6 أحرف على الأقل" });
    }
    if (!/^\d{9,10}$/.test(cleanPhone.replace(/\s/g, ""))) {
      return res.status(400).json({ error: "رقم الهاتف غير صالح (9 إلى 10 أرقام)" });
    }

    const existing = await getUser(cleanUsername);
    if (existing) {
      return res.status(409).json({ error: "اسم المستخدم هذا مأخوذ، جرب اسماً آخر" });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user: User = {
      username: cleanUsername,
      phone: cleanPhone,
      passwordHash,
      createdAt: new Date().toISOString(),
      activated: false,
    };

    await db.set(userKey(cleanUsername), JSON.stringify(user));

    const token = jwt.sign(
      { username: cleanUsername, phone: cleanPhone, activated: false },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(201).json({
      success: true,
      message: "تم إنشاء الحساب بنجاح!",
      token,
      user: { username: cleanUsername, phone: cleanPhone, activated: false },
    });
  } catch (err) {
    console.error("Register error:", err);
    return res.status(500).json({ error: "خطأ في الخادم، حاول مجدداً" });
  }
});

router.post("/auth/activate", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).json({ error: "يجب تسجيل الدخول أولاً قبل التفعيل" });
    }

    let payload: { username: string } & Record<string, unknown>;
    try {
      payload = jwt.verify(token, JWT_SECRET) as typeof payload;
    } catch {
      return res.status(401).json({ error: "جلسة منتهية، أعد تسجيل الدخول" });
    }

    const user = await getUser(payload.username);
    if (!user) {
      return res.status(404).json({ error: "الحساب غير موجود" });
    }

    const updatedUser: User = { ...user, activated: true };
    await db.set(userKey(user.username), JSON.stringify(updatedUser));

    const newToken = jwt.sign(
      { username: user.username, phone: user.phone, activated: true },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      success: true,
      message: "تم تفعيل الحساب بنجاح!",
      token: newToken,
      user: { username: user.username, phone: user.phone, activated: true },
    });
  } catch (err) {
    console.error("Activate error:", err);
    return res.status(500).json({ error: "خطأ في الخادم، حاول مجدداً" });
  }
});

router.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body as {
      username?: string;
      password?: string;
    };

    if (!username || !password) {
      return res.status(400).json({ error: "أدخل اسم المستخدم وكلمة السر" });
    }

    const user = await getUser(username);
    if (!user) {
      return res.status(401).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
    }

    const token = jwt.sign(
      { username: user.username, phone: user.phone, activated: user.activated },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      success: true,
      message: `مرحباً ${user.username}!`,
      token,
      user: { username: user.username, phone: user.phone, activated: user.activated },
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "خطأ في الخادم، حاول مجدداً" });
  }
});

export default router;
