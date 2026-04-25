# بناء AAB لتطبيق سِيغْمَا — الحلّ الجذري النهائي

هذا المجلّد يحوي **كل ما يلزم** لبناء ملف Android AAB جاهز للرفع على Google Play، **بدون** الاعتماد على PWABuilder أو أيّ خدمة بطيئة.

## كيف يعمل

عند كل `git push` يُعدِّل ملفاً في `twa-source/`، يُشغِّل **GitHub Actions** بناءً تلقائياً:

1. يُنزِّل Java + Android SDK + Bubblewrap على ubuntu runner مجّاني
2. يستعمل `twa-manifest.json` + الـ keystore (من GitHub Secret) لبناء AAB
3. يُحمِّل النتيجة كـ **artifact** قابل للتنزيل من Actions tab
4. يطبع SHA-256 في logs (موجود مسبقاً في `assetlinks.json`)

**كل بناء يستغرق ~10 دقائق ولا يحتاج أيّ تدخّل.**

---

## الإعداد الأوّل (مرّة واحدة فقط)

افتح ملف **`.local/sigma-keystore-credentials.txt`** — يحوي كل البيانات الحساسة + خطوات إضافة الـ 3 secrets على GitHub. **لا تشاركه مع أحد.**

ثم في GitHub:
1. Repo → **Settings** → **Secrets and variables** → **Actions**
2. أضف 3 secrets كما هو موضّح في الملف
3. Tab **Actions** → **Build Sigma Android AAB** → **Run workflow**

---

## محتوى المجلّد

| الملف | الوصف | في git؟ |
|---|---|---|
| `twa-manifest.json` | إعدادات Bubblewrap الكاملة | ✅ نعم |
| `sigma-release.keystore` | مفتاح التوقيع الفعلي | ❌ لا (محمي) — base64 في GitHub Secret |
| `README.md` | هذا الملف | ✅ نعم |

---

## معلومات التطبيق

| الحقل | القيمة |
|---|---|
| Package ID | `com.sigma.education.dz` |
| Display Name | سِيغْمَا — مصحح رياضيات البكالوريا |
| Launcher | `سِيغْمَا Σ` |
| Min SDK | 21 (Android 5.0+) |
| Target SDK | 34 (Android 14) |
| Orientation | Portrait (RTL) |
| Theme | `#6366F1` (بنفسجي سيغما) |
| Background | `#0F0F1A` (داكن) |
| Host | `sigmaaidzbac.replit.app` |
| Push Notifications | مُفعَّلة |

---

## SHA-256 للتحقّق من الربط

```
4E:4E:5C:AD:0D:2D:D0:1E:EE:9A:79:43:F1:A8:6B:48:2B:B4:7B:92:14:4B:41:93:AD:AD:E1:F3:2C:1C:26:B9
```

موضوع بالفعل في `artifacts/sheikh-dhaki/public/.well-known/assetlinks.json`. **لا تحتاج لانتظار Google Play Console** — هذا SHA هو نفسه الذي سيُستعمل لتوقيع التطبيق.

> ⚠️ **ملاحظة حول Play App Signing**: عند رفع AAB لأوّل مرّة، Google ستعرض عليك خياراً للسماح لها بإدارة المفتاح ("Play App Signing"). إذا قبلت، Google ستُعيد توقيع التطبيق بمفتاحها الخاصّ، وستحصل على SHA-256 **مختلف** من Console — في تلك الحالة، استبدل القيمة في `assetlinks.json` بالقيمة الجديدة.
> 
> إذا اخترت **Opt out** (استعمال مفتاحك الشخصي)، الـ SHA-256 أعلاه يكفي ولا حاجة لتحديث.

---

## الخطوات بعد البناء

1. اذهب لـ **Actions** في GitHub
2. افتح آخر run ناجح → نزّل artifact `sigma-android-release`
3. ستجد:
   - `app-release-bundle.aab` ← لـ Google Play Console
   - `app-release-signed.apk` ← للاختبار المباشر على هاتفك (اختياري)
4. ادخل **https://play.google.com/console**
5. أنشئ تطبيقاً جديداً → **Production** → **Create new release**
6. ارفع `app-release-bundle.aab`
7. املأ معلومات المتجر (الأيقونة + الصور موجودة في `artifacts/sheikh-dhaki/public/`)
8. أرسل للمراجعة → ينتظر 1-3 أيام

---

## تحديث التطبيق لاحقاً

أيّ تعديل تنشره على Replit يصل المستخدمين **فوراً** (PWA). لن تحتاج لرفع AAB جديد إلا إذا غيّرت:
- اسم التطبيق
- الأيقونة
- أذونات الأندرويد
- Target SDK
- Deep Linking

عند الحاجة: زِد `appVersionCode` في `twa-manifest.json` بمقدار 1 → push → AAB جديد جاهز خلال 10 دقائق.
