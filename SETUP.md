# راه‌اندازی داشبورد استاتیک روی GitHub Pages

## ۱) کپی فایل‌ها
این پوشه‌ها/فایل‌ها را داخل ریپازیتوری `Jobvision-market-analysis` خودت کپی کن (کنار app.py و scraper.py که از قبل داری):

```
.github/workflows/update-data.yml
generate_data.py
docs/index.html
docs/style.css
docs/script.js
docs/data/jobs.json
```

سپس commit و push کن:

```bash
git add .github generate_data.py docs
git commit -m "feat: static dashboard on GitHub Pages via scheduled Action"
git push
```

## ۲) اجازه‌ی نوشتن به Action بده
در ریپو برو به:
`Settings → Actions → General → Workflow permissions`
و گزینه‌ی **Read and write permissions** را انتخاب و ذخیره کن.
(بدون این، Action نمی‌تونه نتیجه‌ی اسکرپ رو commit/push کنه.)

## ۳) GitHub Pages را فعال کن
`Settings → Pages`
- Source: **Deploy from a branch**
- Branch: **main** — پوشه‌ی **/docs**
- Save

بعد از چند دقیقه، سایتت روی آدرسی مثل زیر بالا میاد:
```
https://zanko-km.github.io/Jobvision-market-analysis/
```

## ۴) اولین اجرای دستی
برای اینکه لازم نباشه ۶ ساعت صبر کنی، برو به تب **Actions**، روی workflow با نام
**Update JobVision Data** بزن، و دکمه‌ی **Run workflow** رو بزن تا همین الان
داده‌ها ساخته و commit بشن.

## نکات
- زمان‌بندی پیش‌فرض هر ۶ ساعت یک‌بار اجرا می‌شه (در `.github/workflows/update-data.yml`
  قابل تغییره — فرمت آن استاندارد cron است).
- چون سایت استاتیکه، جستجو روی همون داده‌ی ذخیره‌شده (که هر چند ساعت
  آپدیت می‌شه) فیلتر می‌کنه، نه روی API زنده‌ی JobVision.
- هزینه: صفر تومان. هم GitHub Actions برای ریپوی public نامحدوده،
  هم GitHub Pages کاملاً رایگانه.
