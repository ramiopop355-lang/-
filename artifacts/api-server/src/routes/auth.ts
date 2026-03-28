import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "@replit/database";
import multer from "multer";

const router: IRouter = Router();
const db = new Database();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("يجب رفع صورة الوصل"));
  },
});

const JWT_SECRET = process.env["JWT_SECRET"] ?? "ustad-riyad-2026-secret-key";
const SALT_ROUNDS = 10;
const MAX_DEVICES = 3;

interface DeviceInfo {
  id: string;
  name: string;
  registeredAt: string;
}

interface User {
  username: string;
  phone: string;
  passwordHash: string;
  createdAt: string;
  activated: boolean;
  devices: DeviceInfo[];
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
      devices: [],
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

router.post("/auth/activate", upload.single("receipt"), async (req, res) => {
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

    // قبول أي وصل دفع مهما كان نوعه — التفعيل فوري
    const receiptMeta = req.file
      ? { size: req.file.size, mime: req.file.mimetype, at: new Date().toISOString() }
      : { at: new Date().toISOString() };

    const updatedUser: User = {
      ...user,
      activated: true,
      // @ts-ignore
      receiptUploaded: receiptMeta,
    };
    await db.set(userKey(user.username), JSON.stringify(updatedUser));

    const newToken = jwt.sign(
      { username: user.username, phone: user.phone, activated: true },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    console.info(`[ACTIVATE] ${user.username} — وصل: ${req.file ? req.file.mimetype + " " + req.file.size + "b" : "بدون صورة"}`);

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
    const { username, password, deviceId, deviceName } = req.body as {
      username?: string;
      password?: string;
      deviceId?: string;
      deviceName?: string;
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

    // ── إدارة الأجهزة ──────────────────────────────────────────
    const devices: DeviceInfo[] = user.devices ?? [];

    if (deviceId) {
      const alreadyRegistered = devices.some((d) => d.id === deviceId);

      if (!alreadyRegistered) {
        if (devices.length >= MAX_DEVICES) {
          return res.status(403).json({
            error: `تم تجاوز الحد الأقصى للأجهزة (${MAX_DEVICES} أجهزة). احذف جهازاً قديماً من إعدادات حسابك.`,
            code: "DEVICE_LIMIT_REACHED",
            deviceCount: devices.length,
          });
        }
        devices.push({
          id: deviceId,
          name: deviceName ?? "جهاز غير معروف",
          registeredAt: new Date().toISOString(),
        });
        const updatedUser: User = { ...user, devices };
        await db.set(userKey(user.username), JSON.stringify(updatedUser));
      }
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
      deviceCount: devices.length,
    });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "خطأ في الخادم، حاول مجدداً" });
  }
});

// ── إدارة الأجهزة ────────────────────────────────────────────────
router.get("/auth/devices", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });

    let payload: { username: string } & Record<string, unknown>;
    try { payload = jwt.verify(token, JWT_SECRET) as typeof payload; }
    catch { return res.status(401).json({ error: "جلسة منتهية، أعد تسجيل الدخول" }); }

    const user = await getUser(payload.username);
    if (!user) return res.status(404).json({ error: "الحساب غير موجود" });

    const devices = (user.devices ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      registeredAt: d.registeredAt,
    }));

    return res.json({ devices, max: MAX_DEVICES });
  } catch (err) {
    console.error("Devices error:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

router.delete("/auth/devices/:deviceId", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: "يجب تسجيل الدخول أولاً" });

    let payload: { username: string } & Record<string, unknown>;
    try { payload = jwt.verify(token, JWT_SECRET) as typeof payload; }
    catch { return res.status(401).json({ error: "جلسة منتهية، أعد تسجيل الدخول" }); }

    const user = await getUser(payload.username);
    if (!user) return res.status(404).json({ error: "الحساب غير موجود" });

    const { deviceId } = req.params;
    const filtered = (user.devices ?? []).filter((d) => d.id !== deviceId);
    const updatedUser: User = { ...user, devices: filtered };
    await db.set(userKey(user.username), JSON.stringify(updatedUser));

    return res.json({ success: true, message: "تم حذف الجهاز بنجاح", devices: filtered });
  } catch (err) {
    console.error("Delete device error:", err);
    return res.status(500).json({ error: "خطأ في الخادم" });
  }
});

export default router;
