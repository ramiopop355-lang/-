import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "@replit/database";
import multer from "multer";
import https from "https";

// ── تحليل وصل CCP بالذكاء الاصطناعي ─────────────────────────────────
const GEMINI_KEYS = [
  process.env["GEMINI_API_KEY"],
  process.env["GEMINI_API_KEY_2"],
  process.env["GEMINI_API_KEY_3"],
  process.env["GEMINI_API_KEY_4"],
  process.env["GEMINI_API_KEY_5"],
].filter(Boolean) as string[];

let geminiKeyIndex = 0;
function nextGeminiKey(): string | null {
  if (!GEMINI_KEYS.length) return null;
  const key = GEMINI_KEYS[geminiKeyIndex % GEMINI_KEYS.length];
  geminiKeyIndex++;
  return key ?? null;
}

async function verifyCCPReceipt(imageBuffer: Buffer, mimeType: string): Promise<{ valid: boolean; reason: string }> {
  const base64Image = imageBuffer.toString("base64");

  const prompt = `أنت خبير في التحقق من وثائق الدفع الجزائرية.
حلل الصورة المرفقة وحدد بدقة إذا كانت وصل تأكيد دفع حقيقي عبر CCP (الحساب البريدي الجاري) الصادر من بريد الجزائر / Algérie Poste.

تحقق من وجود العناصر التالية:
- شعار بريد الجزائر أو أي مؤشر على CCP
- رقم الحساب البريدي (CCP)
- مبلغ الدفع
- تاريخ العملية
- رقم مرجعي أو رقم العملية

أجب بالتنسيق الآتي فقط (سطر واحد):
VALID: [نعم/لا] | REASON: [سبب موجز بالعربية]

إذا كانت الصورة ضبابية أو غير واضحة ولكنها تُظهر عناصر وصل CCP، اعتبرها صالحة.
إذا كانت الصورة لا علاقة لها بوصل CCP (مثلاً صورة شخصية، منظر طبيعي، شاشة فارغة، إلخ)، اعتبرها غير صالحة.`;

  const body = JSON.stringify({
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: base64Image } }
        ]
      }
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 120 }
  });

  // نحاول OpenRouter أولاً
  const openrouterKey = process.env["OPENROUTER_API_KEY"];
  if (openrouterKey) {
    try {
      const result = await callOpenRouterVision(openrouterKey, base64Image, mimeType, prompt);
      return parseVerificationResult(result);
    } catch (err) {
      console.warn("[CCP-VERIFY] OpenRouter failed, trying Gemini keys:", err);
    }
  }

  // الاحتياط: مفاتيح Gemini المباشرة
  for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
    const key = nextGeminiKey();
    if (!key) break;
    try {
      const result = await callGeminiDirect(key, body);
      return parseVerificationResult(result);
    } catch (err) {
      console.warn(`[CCP-VERIFY] Gemini key ${attempt + 1} failed:`, err);
    }
  }

  // إذا فشل كل شيء نُفعّل تلقائياً لتجنب حجب المستخدم
  console.error("[CCP-VERIFY] All providers failed — allowing activation as fallback");
  return { valid: true, reason: "تحقق تلقائي بسبب عطل مؤقت" };
}

function callOpenRouterVision(apiKey: string, base64Image: string, mimeType: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } }
          ]
        }
      ],
      max_tokens: 120,
      temperature: 0.1
    });

    const req = https.request({
      hostname: "openrouter.ai",
      path: "/api/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://sigmaaidzbac.replit.app",
        "X-Title": "Sigma Bac",
        "Content-Length": Buffer.byteLength(payload),
      }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.choices?.[0]?.message?.content ?? "";
          if (!text) return reject(new Error("Empty response from OpenRouter"));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function callGeminiDirect(apiKey: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const path = `/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          if (!text) return reject(new Error("Empty response from Gemini"));
          resolve(text);
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseVerificationResult(text: string): { valid: boolean; reason: string } {
  const match = text.match(/VALID:\s*(نعم|لا|yes|no)/i);
  const reasonMatch = text.match(/REASON:\s*(.+)/i);
  const reason = reasonMatch?.[1]?.trim() ?? text.trim();
  if (!match) {
    // إذا لم يُطابق التنسيق، نُفعّل لتجنب الرفض الخاطئ
    return { valid: true, reason: "تم قبول الوصل" };
  }
  const valid = ["نعم", "yes"].includes(match[1].toLowerCase());
  return { valid, reason };
}

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
  receiptUploaded?: { size?: number; mime?: string; at: string; method?: string };
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

    if (!req.file) {
      return res.status(400).json({ error: "يجب إرفاق صورة الوصل للتفعيل" });
    }

    const paymentMethod = (req.body as Record<string, string>)["paymentMethod"] ?? "baridimob";

    // ── التحقق بالذكاء الاصطناعي للـ CCP فقط ──────────────────────────
    if (paymentMethod === "ccp") {
      console.info(`[ACTIVATE-CCP] ${user.username} — جاري تحليل الوصل بالذكاء الاصطناعي...`);
      const verification = await verifyCCPReceipt(req.file.buffer, req.file.mimetype);

      if (!verification.valid) {
        console.warn(`[ACTIVATE-CCP] ${user.username} — رُفض: ${verification.reason}`);
        return res.status(400).json({
          error: "لم يتم التعرف على الوصل كتأكيد دفع CCP صالح",
          reason: verification.reason,
          code: "INVALID_CCP_RECEIPT",
        });
      }

      console.info(`[ACTIVATE-CCP] ${user.username} — مقبول: ${verification.reason}`);
    }

    const receiptMeta = {
      size: req.file.size,
      mime: req.file.mimetype,
      at: new Date().toISOString(),
      method: paymentMethod,
    };
    const updatedUser: User = { ...user, activated: true, receiptUploaded: receiptMeta };
    await db.set(userKey(user.username), JSON.stringify(updatedUser));

    const newToken = jwt.sign(
      { username: user.username, phone: user.phone, activated: true },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    const methodLabel = paymentMethod === "ccp" ? "CCP" : "بريدي موب";
    console.info(`[ACTIVATE] ${user.username} — ${methodLabel} — ${req.file.size} bytes`);

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
