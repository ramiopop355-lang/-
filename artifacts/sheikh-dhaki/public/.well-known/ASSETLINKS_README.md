# Digital Asset Links — تحديث assetlinks.json بعد رفع APK على Play Console

ملف `assetlinks.json` ضروري لتطبيق Android TWA (Trusted Web Activity) كي لا يظهر شريط المتصفح أعلى الشاشة. حالياً الـ SHA-256 موضوع كـ placeholder ويجب استبداله بعد رفع تطبيقك على Google Play Console.

## الخطوات

### 1) أنشئ APK عبر PWABuilder
1. ادخل على https://www.pwabuilder.com
2. أدخل رابط تطبيقك: `https://sigmaaidzbac.replit.app`
3. اختر **Android Package** ثم **Generate**
4. حمّل ملف `.aab` (Android App Bundle)

### 2) ارفع على Play Console
1. ادخل على https://play.google.com/console
2. أنشئ تطبيقاً جديداً → **Production** → ارفع ملف `.aab`
3. بعد القبول الأوّلي، روح إلى:
   **Setup → App integrity → App signing**
4. انسخ قيمة **App signing key certificate → SHA-256 certificate fingerprint**
   (تكون بصيغة: `XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX:XX`)

### 3) حدّث ملف `assetlinks.json`
افتح:
```
artifacts/sheikh-dhaki/public/.well-known/assetlinks.json
```

استبدل قيمة `sha256_cert_fingerprints` بالقيمة من Play Console:
```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.sigmaaidzbac.twa",
      "sha256_cert_fingerprints": [
        "PASTE_HERE_FROM_PLAY_CONSOLE"
      ]
    }
  }
]
```

> **مهم:** استبدل `package_name` بالاسم الفعلي اللي اخترته في PWABuilder (مثل `com.sigma.bac` أو ما شابه).

### 4) أعد النشر
بعد الحفظ، اضغط زرّ **Publish** في Replit. الملف سيكون متاحاً على:
```
https://sigmaaidzbac.replit.app/.well-known/assetlinks.json
```

### 5) تأكّد
افتح الرابط في المتصفح وتحقق من ظهور SHA-256 الصحيح. ثم في Play Console، التطبيق سيتحقق تلقائياً من الربط في غضون 24 ساعة. عند فتح APK، شريط المتصفح يجب أن يختفي.

## ملاحظات

- يمكن وضع أكثر من SHA-256 في `sha256_cert_fingerprints` (مفيد إذا عندك مفتاح upload منفصل عن مفتاح signing).
- إذا استعملت Play App Signing (الافتراضي الآن)، استعمل SHA-256 من Play Console — **ليس** SHA-256 من keystore المحلي.
- لاختبار التحقق من الرابط، استعمل أداة Google: https://developers.google.com/digital-asset-links/tools/generator
