import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "@replit/database";
import multer from "multer";
import https from "https";
import crypto from "crypto";

// ── مستوى الأمان ───────────────────────────────────────────────────
// normal  → يقبل أي وصل يحتوي على مبلغ صحيح + كلمة مفتاحية واحدة
// strict  → يشترط رقم عملية + كلمة مفتاحية + تاريخ
// ultra   → يشترط كل شيء + التاريخ يجب ألا يتجاوز 7 أيام
type SecurityLevel = "normal" | "strict" | "ultra";
const SECURITY_LEVEL: SecurityLevel = "strict";

// ── مفاتيح Gemini ──────────────────────────────────────────────────
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

// ── بنية بيانات الوصل المستخرجة ─────────────────────────────────────
interface ReceiptData {
  amount: number | null;        // المبلغ بالدينار
  transactionId: string | null; // رقم العملية (6+ أرقام)
  date: string | null;          // التاريخ المستخرج (YYYY-MM-DD أو نص)
  keywords: string[];           // كلمات مفتاحية موجودة
  rawText: string;              // النص الخام من الذكاء الاصطناعي
  confidence: "high" | "low";  // مدى وضوح الصورة
}

interface VerificationResult {
  valid: boolean;
  reason: string;
  code: "ACCEPTED" | "REJECTED" | "DUPLICATE_TXN" | "DUPLICATE_IMAGE" | "INSUFFICIENT_DATA" | "LOW_AMOUNT";
  data?: Partial<ReceiptData>;
}

// ── استخراج hash للصورة (للكشف عن الصور المكررة) ──────────────────
function hashImage(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// ── البرومبت المنظّم لاستخراج بيانات الوصل ──────────────────────────
function buildExtractionPrompt(): string {
  return `أنت نظام OCR متخصص في تحليل وصولات الدفع الجزائرية (CCP / BaridiMob / Algérie Poste).

حلّل الصورة المرفقة واستخرج البيانات التالية بدقة:

1. AMOUNT: المبلغ المدفوع بالدينار الجزائري (رقم فقط، بدون حروف أو رموز). إذا وجدت أرقاماً متعددة اختر المبلغ المنطقي بين 100 و 100000 دج.
2. TXN_ID: رقم العملية أو المرجع أو رقم الإيصال (يجب أن يكون 6 أرقام أو أكثر). إذا لم يوجد اكتب NONE.
3. DATE: تاريخ العملية بصيغة YYYY-MM-DD. إذا لم يوجد اكتب NONE.
4. KEYWORDS: اذكر الكلمات المفتاحية الموجودة في الصورة من هذه القائمة فقط (مفصولة بفاصلة): baridi, poste, ccp, algerie, virement, recharge, موبايل, بريد, تحويل, رصيد, إيداع
5. CONFIDENCE: هل الصورة واضحة بما يكفي لقراءة البيانات؟ أجب بـ high أو low فقط.

أجب بهذا التنسيق الحرفي فقط (لا تضف أي شرح):
AMOUNT: [رقم أو NONE]
TXN_ID: [رقم أو NONE]
DATE: [YYYY-MM-DD أو NONE]
KEYWORDS: [قائمة أو NONE]
CONFIDENCE: [high أو low]`;
}

// ── تحليل رد الذكاء الاصطناعي وتحويله إلى بنية بيانات ───────────────
function parseReceiptData(rawText: string): ReceiptData {
  const get = (key: string): string => {
    const m = rawText.match(new RegExp(`${key}:\\s*(.+)`, "i"));
    return m?.[1]?.trim() ?? "NONE";
  };

  const amountStr = get("AMOUNT");
  const amount = amountStr !== "NONE" ? parseFloat(amountStr.replace(/[^\d.]/g, "")) || null : null;

  const txnRaw = get("TXN_ID");
  const transactionId = txnRaw !== "NONE" && /\d{6,}/.test(txnRaw) ? txnRaw.match(/\d{6,}/)?.[0] ?? null : null;

  const dateRaw = get("DATE");
  const date = dateRaw !== "NONE" ? dateRaw : null;

  const kwRaw = get("KEYWORDS");
  const keywords = kwRaw !== "NONE"
    ? kwRaw.split(",").map(k => k.trim().toLowerCase()).filter(Boolean)
    : [];

  const confRaw = get("CONFIDENCE").toLowerCase();
  const confidence = confRaw === "high" ? "high" : "low";

  return { amount, transactionId, date, keywords, rawText, confidence };
}

// ── منطق التحقق حسب مستوى الأمان ────────────────────────────────────
function applyVerificationLogic(data: ReceiptData, level: SecurityLevel): VerificationResult {
  const KEYWORDS_POOL = ["baridi", "poste", "ccp", "algerie", "virement", "recharge", "موبايل", "بريد", "تحويل", "رصيد", "إيداع"];
  const hasKeyword = data.keywords.some(k => KEYWORDS_POOL.includes(k));
  const MIN_AMOUNT = 500;

  // التحقق من المبلغ (مشترك بين كل المستويات)
  if (data.amount === null) {
    return { valid: false, reason: "لم يتم العثور على مبلغ الدفع في الوصل", code: "INSUFFICIENT_DATA" };
  }
  if (data.amount < MIN_AMOUNT) {
    return {
      valid: false,
      reason: `المبلغ المكتشف (${data.amount} دج) أقل من الحد الأدنى المطلوب (${MIN_AMOUNT} دج)`,
      code: "LOW_AMOUNT",
    };
  }

  if (level === "normal") {
    // المستوى العادي: مبلغ صحيح + كلمة مفتاحية واحدة على الأقل
    if (!hasKeyword) {
      return { valid: false, reason: "الصورة لا تحتوي على مؤشرات وصل بريد الجزائر", code: "INSUFFICIENT_DATA" };
    }
    return { valid: true, reason: `مقبول — مبلغ: ${data.amount} دج`, code: "ACCEPTED" };
  }

  if (level === "strict") {
    // المستوى الصارم: مبلغ + كلمة مفتاحية + رقم عملية
    if (!hasKeyword) {
      return { valid: false, reason: "الوصل لا يحتوي على مؤشرات بريد الجزائر / CCP / BaridiMob", code: "INSUFFICIENT_DATA" };
    }
    if (!data.transactionId) {
      return { valid: false, reason: "لم يُعثر على رقم العملية (6 أرقام أو أكثر)", code: "INSUFFICIENT_DATA" };
    }
    return {
      valid: true,
      reason: `مقبول — مبلغ: ${data.amount} دج | رقم العملية: ${data.transactionId}`,
      code: "ACCEPTED",
    };
  }

  // ultra: مبلغ + كلمة مفتاحية + رقم عملية + تاريخ لا يتجاوز 7 أيام
  if (!hasKeyword) {
    return { valid: false, reason: "الوصل لا يحتوي على مؤشرات بريد الجزائر / CCP / BaridiMob", code: "INSUFFICIENT_DATA" };
  }
  if (!data.transactionId) {
    return { valid: false, reason: "لم يُعثر على رقم العملية (6 أرقام أو أكثر)", code: "INSUFFICIENT_DATA" };
  }
  if (!data.date) {
    return { valid: false, reason: "لم يُعثر على تاريخ العملية في الوصل", code: "INSUFFICIENT_DATA" };
  }
  const receiptDate = new Date(data.date);
  const now = new Date();
  const diffDays = (now.getTime() - receiptDate.getTime()) / (1000 * 60 * 60 * 24);
  if (isNaN(diffDays) || diffDays > 7) {
    return {
      valid: false,
      reason: `تاريخ الوصل (${data.date}) يتجاوز 7 أيام — يُرجى استخدام وصل حديث`,
      code: "REJECTED",
    };
  }
  return {
    valid: true,
    reason: `مقبول — مبلغ: ${data.amount} دج | رقم العملية: ${data.transactionId} | التاريخ: ${data.date}`,
    code: "ACCEPTED",
  };
}

// ── استدعاء Gemini Vision عبر OpenRouter ─────────────────────────────
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
      max_tokens: 200,
      temperature: 0.0
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

// ── استدعاء Gemini مباشرة (احتياط) ───────────────────────────────────
function callGeminiDirect(apiKey: string, base64Image: string, mimeType: string, prompt: string): Promise<string> {
  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64Image } }
      ]
    }],
    generationConfig: { temperature: 0.0, maxOutputTokens: 200 }
  });
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

// ── دالة التحقق الشاملة من الوصل ─────────────────────────────────────
async function verifyPaymentReceipt(
  imageBuffer: Buffer,
  mimeType: string,
  db: Database,
  level: SecurityLevel = SECURITY_LEVEL
): Promise<VerificationResult> {
  const imageHash = hashImage(imageBuffer);
  const base64Image = imageBuffer.toString("base64");
  const prompt = buildExtractionPrompt();

  // ── 1. التحقق من تكرار الصورة (نفس الصورة مرتين) ──────────────────
  const hashKey = `receipt:hash:${imageHash}`;
  const existingHash = await db.get(hashKey);
  if (existingHash.ok && existingHash.value) {
    return {
      valid: false,
      reason: "هذه الصورة استُخدمت من قبل لتفعيل حساب آخر",
      code: "DUPLICATE_IMAGE",
    };
  }

  // ── 2. استخراج البيانات بالذكاء الاصطناعي ───────────────────────────
  let rawText = "";
  const openrouterKey = process.env["OPENROUTER_API_KEY"];
  if (openrouterKey) {
    try {
      rawText = await callOpenRouterVision(openrouterKey, base64Image, mimeType, prompt);
      console.info("[RECEIPT-OCR] OpenRouter نجح في استخراج البيانات");
    } catch (err) {
      console.warn("[RECEIPT-OCR] OpenRouter فشل، يُجرّب Gemini:", (err as Error).message?.substring(0, 80));
    }
  }

  if (!rawText) {
    for (let attempt = 0; attempt < GEMINI_KEYS.length; attempt++) {
      const key = nextGeminiKey();
      if (!key) break;
      try {
        rawText = await callGeminiDirect(key, base64Image, mimeType, prompt);
        console.info(`[RECEIPT-OCR] Gemini key ${attempt + 1} نجح`);
        break;
      } catch (err) {
        console.warn(`[RECEIPT-OCR] Gemini key ${attempt + 1} فشل:`, (err as Error).message?.substring(0, 80));
      }
    }
  }

  // ── 3. إذا فشل كل شيء → رفض مع رسالة واضحة ─────────────────────
  if (!rawText) {
    console.error("[RECEIPT-OCR] كل المزودين فشلوا — رفض الطلب");
    return {
      valid: false,
      reason: "تعذّر التحقق من الوصل بسبب عطل مؤقت في الخدمة — حاول مجدداً خلال دقيقة",
      code: "INSUFFICIENT_DATA",
    };
  }

  const data = parseReceiptData(rawText);
  console.info("[RECEIPT-OCR] البيانات المستخرجة:", {
    amount: data.amount,
    transactionId: data.transactionId,
    date: data.date,
    keywords: data.keywords,
    confidence: data.confidence,
  });

  // ── 4. التحقق من تكرار رقم العملية ──────────────────────────────────
  if (data.transactionId) {
    const txnKey = `receipt:txn:${data.transactionId}`;
    const existingTxn = await db.get(txnKey);
    if (existingTxn.ok && existingTxn.value) {
      return {
        valid: false,
        reason: `رقم العملية ${data.transactionId} استُخدم مسبقاً لتفعيل حساب آخر`,
        code: "DUPLICATE_TXN",
        data,
      };
    }
  }

  // ── 5. تطبيق منطق التحقق حسب المستوى ────────────────────────────────
  const result = applyVerificationLogic(data, level);
  result.data = data;

  // ── 6. إذا قُبل → حفظ الـ hash ورقم العملية لمنع إعادة الاستخدام ───
  if (result.valid) {
    const meta = { at: new Date().toISOString(), amount: data.amount, level };
    await db.set(hashKey, JSON.stringify(meta));
    if (data.transactionId) {
      await db.set(`receipt:txn:${data.transactionId}`, JSON.stringify(meta));
    }
  }

  return result;
}

// ── Express Router ────────────────────────────────────────────────────
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

// يجب أن يكون متغير البيئة موجوداً — نرفض التشغيل بدونه
const JWT_SECRET = process.env["JWT_SECRET"];
if (!JWT_SECRET) throw new Error("[STARTUP] JWT_SECRET environment variable is not set — server cannot start securely");
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
  receiptUploaded?: { size?: number; mime?: string; at: string; method?: string; txnId?: string };
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

// ── تسجيل حساب جديد ────────────────────────────────────────────────
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

// ── تفعيل الحساب برفع وصل الدفع ────────────────────────────────────
router.post("/auth/activate", upload.single("receipt"), async (req, res) => {
  try {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
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
    if (!user) return res.status(404).json({ error: "الحساب غير موجود" });

    if (!req.file) {
      return res.status(400).json({ error: "يجب إرفاق صورة الوصل للتفعيل" });
    }

    const paymentMethod = (req.body as Record<string, string>)["paymentMethod"] ?? "baridimob";

    console.info(`[ACTIVATE] ${user.username} — طريقة الدفع: ${paymentMethod} — مستوى الأمان: ${SECURITY_LEVEL}`);

    // ── التحقق الشامل من الوصل (يعمل لـ CCP و BaridiMob معاً) ─────────
    const verification = await verifyPaymentReceipt(req.file.buffer, req.file.mimetype, db, SECURITY_LEVEL);

    if (!verification.valid) {
      const arabicCode: Record<string, string> = {
        DUPLICATE_IMAGE: "الصورة مستخدمة مسبقاً",
        DUPLICATE_TXN: "رقم العملية مستخدم مسبقاً",
        LOW_AMOUNT: "المبلغ غير كافٍ",
        INSUFFICIENT_DATA: "بيانات الوصل غير كاملة",
        REJECTED: "الوصل مرفوض",
      };
      console.warn(`[ACTIVATE] ${user.username} — رُفض (${verification.code}): ${verification.reason}`);
      return res.status(400).json({
        error: arabicCode[verification.code] ?? "الوصل غير صالح",
        reason: verification.reason,
        code: verification.code,
      });
    }

    console.info(`[ACTIVATE] ${user.username} — مقبول (${verification.code}): ${verification.reason}`);

    const receiptMeta = {
      size: req.file.size,
      mime: req.file.mimetype,
      at: new Date().toISOString(),
      method: paymentMethod,
      txnId: verification.data?.transactionId ?? undefined,
    };
    const updatedUser: User = { ...user, activated: true, receiptUploaded: receiptMeta };
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
      receipt: {
        amount: verification.data?.amount,
        transactionId: verification.data?.transactionId,
        date: verification.data?.date,
      },
    });
  } catch (err) {
    console.error("Activate error:", err);
    return res.status(500).json({ error: "خطأ في الخادم، حاول مجدداً" });
  }
});

// ── تسجيل الدخول ───────────────────────────────────────────────────
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

    const normalizedUsername = username.toLowerCase().trim();
    console.info(`[LOGIN] محاولة دخول — المستخدم: "${normalizedUsername}"`);

    const user = await getUser(username);
    if (!user) {
      console.warn(`[LOGIN] ❌ المستخدم "${normalizedUsername}" غير موجود في قاعدة البيانات`);
      return res.status(401).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      console.warn(`[LOGIN] ❌ كلمة السر خاطئة للمستخدم "${normalizedUsername}"`);
      return res.status(401).json({ error: "اسم المستخدم أو كلمة السر غير صحيحة" });
    }

    console.info(`[LOGIN] ✅ دخول ناجح — "${normalizedUsername}"`);

    // ── إدارة الأجهزة ──────────────────────────────────────────────
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

// ── إدارة الأجهزة ─────────────────────────────────────────────────
router.get("/auth/devices", async (req, res) => {
  try {
    const authHeader = req.headers["authorization"] ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
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
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
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
