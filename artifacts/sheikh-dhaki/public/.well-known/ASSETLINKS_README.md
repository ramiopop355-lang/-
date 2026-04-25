# دليل تحويل سِيغْمَا إلى تطبيق أندرويد جاهز لـ Google Play

## لماذا TWA وليس Capacitor؟

تطبيقك **PWA كامل ومنشور بالفعل** على `https://sigmaaidzbac.replit.app`. لذا الحلّ الأمثل هو **Trusted Web Activity (TWA)** عبر Bubblewrap أو PWABuilder، وليس Capacitor:

| | TWA (الموصى به ✅) | Capacitor |
|---|---|---|
| الكود الأصلي | يستعمل تطبيقك الويب كما هو | يحتاج إعادة تجميع كاملة |
| التحديثات | تنشر على Replit → تظهر فوراً للمستخدم | نشر جديد + إعادة بناء AAB لكل تعديل |
| حجم التطبيق | ~ 200 KB (مجرّد غلاف) | ~ 5–20 MB (يحوي الويب فيو + الأصول) |
| اعتماد جوجل | مقبول رسمياً منذ 2019 | مقبول |
| تجربة المستخدم | تطابق الويب 100% | احتمال اختلافات بسيطة |
| المسؤولية الأمنية | متصفّح Chrome المحدَّث | مكتبات Capacitor (تتقادم) |
| الجاهزية الحالية | 100% — كل الأصول موجودة | 0% — يحتاج إعداد كامل |

---

## الإعدادات الجاهزة في تطبيقك ✅

| العنصر | القيمة |
|---|---|
| اسم الحزمة (Package Name) | `com.sigma.education.dz` |
| المضيف (Host) | `sigmaaidzbac.replit.app` |
| نقطة البدء (Start URL) | `/` |
| Theme color | `#6366f1` (بنفسجي سيغما) |
| Background color | `#0f0f1a` |
| الاتجاه | عمودي (portrait) |
| اللغة | عربية (RTL) |
| الأيقونة | `/icon-512.png` + maskable |
| Splash Screen | تلقائي (يستعمل background_color + icon) |
| Deep Linking | مدعوم تلقائياً عبر assetlinks.json |
| Service Worker | مفعّل (وضع offline) |
| السياسة | متاحة على `/privacy` |
| الشروط | متاحة على `/terms` |
| Target SDK | 34 (سيُولَّد آلياً بـ Bubblewrap/PWABuilder) |
| Screenshots | narrow + wide موجودة |

---

## الطريق الأسهل: PWABuilder (متصفّح فقط، 5 دقائق)

### 1) توليد AAB
1. ادخل إلى **https://www.pwabuilder.com**
2. أدخل: `https://sigmaaidzbac.replit.app`
3. اضغط **Start** → ستحصل على درجة PWA (يجب أن تكون 90+)
4. اضغط **Package For Stores** → **Android**
5. تحقق من الإعدادات:
   - **Package ID**: `com.sigma.education.dz`
   - **App name**: `سِيغْمَا — مصحح رياضيات البكالوريا`
   - **Launcher name**: `سِيغْمَا Σ`
   - **Theme color**: `#6366f1`
   - **Background**: `#0f0f1a`
   - **Display mode**: `standalone`
   - **Min SDK**: 21 / **Target SDK**: 34
   - **Signing key**: اختر **Generate new** (PWABuilder ينشئ لك مفتاحاً)
6. اضغط **Generate** → حمّل ملف ZIP
7. الـ ZIP يحوي:
   - `app-release-bundle.aab` ← هذا للرفع على Google Play
   - `signing.keystore` + `signing-key-info.txt` ← **احفظهما في مكان آمن جداً**, تحتاجهما لكل تحديث مستقبلي
   - `assetlinks.json` ← انسخ منه قيمة `sha256_cert_fingerprints`

### 2) رفع AAB على Google Play
1. ادخل إلى **https://play.google.com/console**
2. ادفع رسوم التسجيل ($25 لمرة واحدة، إن لم تكن قد دفعت من قبل)
3. أنشئ تطبيقاً جديداً:
   - **App name**: `سِيغْمَا — مصحح رياضيات البكالوريا`
   - **Default language**: Arabic
   - **App or game**: App
   - **Free or paid**: Free
4. اذهب إلى **Production** → **Create new release** → ارفع `app-release-bundle.aab`
5. املأ صفحة المتجر:
   - **Short description**: مصحح رياضيات البكالوريا الجزائرية بالذكاء الاصطناعي
   - **Full description**: (اكتب وصفاً مفصلاً للميزات + اذكر "غير رسمي" بوضوح)
   - **App icon**: `/icon-512.png` (موجود)
   - **Feature graphic**: `/feature-graphic.png` (موجود)
   - **Phone screenshots**: `/screenshot-dashboard.jpg`, `/screenshot-result.jpg`, `/screenshot-narrow.jpg` (موجودة)
   - **Tablet screenshots**: `/screenshot-wide.jpg` (موجود)
   - **Privacy Policy URL**: `https://sigmaaidzbac.replit.app/privacy` (مهم جداً — جوجل ترفض بدونه)
   - **Category**: Education
   - **Content rating**: املأ الاستبيان (تطبيقك تعليمي → All ages)
   - **Target audience**: 13+
   - **Data safety**: صرّح أنك تجمع: اسم المستخدم + صور الوصول للتفعيل (مشفّرة، تُحفظ على الخادم)
6. أرسل للمراجعة (المراجعة الأولى قد تستغرق 1–3 أيام)

### 3) تحديث assetlinks.json (إجباري لإخفاء شريط المتصفح)
بعد قبول التطبيق، Google تُولّد توقيع SHA-256 خاصاً بالنسخة الموقّعة:
1. في Play Console → **Setup → App integrity → App signing**
2. انسخ قيمة **App signing key certificate → SHA-256 certificate fingerprint**
   (بصيغة: `XX:XX:XX:XX:XX:XX:XX:XX:...`)
3. افتح الملف:
   ```
   artifacts/sheikh-dhaki/public/.well-known/assetlinks.json
   ```
4. استبدل `REPLACE_WITH_SHA256_FROM_GOOGLE_PLAY_CONSOLE` بالقيمة المنسوخة:
   ```json
   "sha256_cert_fingerprints": [
     "XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX"
   ]
   ```
5. انشر تحديث Replit → افتح `https://sigmaaidzbac.replit.app/.well-known/assetlinks.json` للتحقق من ظهور القيمة الجديدة بصيغة `application/json`
6. على هاتفك: امسح كاش Chrome ثم افتح التطبيق → سيختفي شريط المتصفح

---

## الطريق المتقدّم: Bubblewrap (سطر أوامر، أكثر تحكّماً)

إذا أردت مفتاح توقيع خاص بك (لا تعتمد على PWABuilder):

```bash
# 1) ثبّت Bubblewrap عالمياً (يحتاج Node.js + Java JDK 17)
npm install -g @bubblewrap/cli

# 2) أنشئ مشروع TWA من الـ manifest
bubblewrap init --manifest=https://sigmaaidzbac.replit.app/manifest.json

# سيسألك عن:
#   - Application ID → com.sigma.education.dz
#   - Application name → سِيغْمَا — مصحح رياضيات البكالوريا
#   - Display mode → standalone
#   - Status bar color → #6366f1
#   - Splash screen color → #0f0f1a
#   - Target SDK → 34
#   - Min SDK → 21
#   - Signing key → سيُولّد jks جديد (احفظ كلمة السر!)

# 3) ابنِ AAB موقّعاً
bubblewrap build

# 4) ستحصل على:
#    - app-release-bundle.aab  ← ارفعه على Google Play Console
#    - assetlinks.json         ← انسخ منه SHA-256
```

---

## ملاحظات مهمة قبل الإطلاق

### 1) النسخ الاحتياطي للمفتاح
**فقدان مفتاح التوقيع = استحالة تحديث التطبيق إلى الأبد.** احفظ:
- `signing.keystore` (أو `.jks`)
- كلمة السرّ
- اسم المفتاح (alias)
على **3 أماكن مختلفة** (Drive + USB + ايميل آمن).

### 2) سياسة الخصوصية
موجودة وجاهزة على `/privacy`. الرابط الذي تضعه على Play Console:
```
https://sigmaaidzbac.replit.app/privacy
```

### 3) العمل المستمرّ للخادم
الخادم يعمل 24/7 على Replit (نشر VM دائم). لا تحتاج تغييراً إضافياً.

### 4) التحديثات
أيّ تعديل تنشره على Replit يصل المستخدمين **فوراً** بدون تحديث APK. لن تحتاج رفع AAB جديد إلا إذا غيّرت:
- اسم التطبيق
- الأيقونة
- أذونات الأندرويد
- Target SDK
- ربط Deep Links جديد
