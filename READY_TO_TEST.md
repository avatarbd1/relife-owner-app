# Stage B — সরাসরি টেস্টের জন্য প্রস্তুত ✅

## তোমার Sheet IDs এবং CSV URLs

### Relife Dental OS
**Sheet ID:** `1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso`

| ট্যাব | CSV URL (gid অনুমান) |
|------|-----------------|
| 06_Payments | https://docs.google.com/spreadsheets/d/1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso/export?format=csv&gid=0 |
| 07_Expenses | https://docs.google.com/spreadsheets/d/1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso/export?format=csv&gid=1 |
| 08_Staff | https://docs.google.com/spreadsheets/d/1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso/export?format=csv&gid=2 |
| 13_Salary | https://docs.google.com/spreadsheets/d/1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso/export?format=csv&gid=3 |
| 21_Cash_Movement | https://docs.google.com/spreadsheets/d/1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso/export?format=csv&gid=4 |

### Relife_Clinic_OS_Database_Template_FIXED (Physio)
**Sheet ID:** `1mDxBpOpmm0elLaYRNCCSZY9UEuNeuFQerLaJRfGuGs0`

| ট্যাব | CSV URL (gid অনুমান) |
|------|-----------------|
| 06_Payments | https://docs.google.com/spreadsheets/d/1mDxBpOpmm0elLaYRNCCSZY9UEuNeuFQerLaJRfGuGs0/export?format=csv&gid=0 |
| 07_Expenses | https://docs.google.com/spreadsheets/d/1mDxBpOpmm0elLaYRNCCSZY9UEuNeuFQerLaJRfGuGs0/export?format=csv&gid=1 |
| 08_Staff | https://docs.google.com/spreadsheets/d/1mDxBpOpmm0elLaYRNCCSZY9UEuNeuFQerLaJRfGuGs0/export?format=csv&gid=2 |
| 13_Salary | https://docs.google.com/spreadsheets/d/1mDxBpOpmm0elLaYRNCCSZY9UEuNeuFQerLaJRfGuGs0/export?format=csv&gid=3 |
| 21_Cash_Movement | https://docs.google.com/spreadsheets/d/1mDxBpOpmm0elLaYRNCCSZY9UEuNeuFQerLaJRfGuGs0/export?format=csv&gid=4 |

## তুমি যা পাবে

✅ `.env.local` — উপরের Dental URLs সহ ইতিমধ্যে সেট করা  
✅ Live CSV ফেচিং কোড — `lib/data/index.ts` এ  
✅ Graceful fallback — কোনো এরর হলে seed ডেটা ব্যবহার করবে

## তুমি যা করবে

1. **ZIP ডাউনলোড করো এবং এক্সট্র্যাক্ট করো**
   ```bash
   unzip relife-owner-app.zip
   cd relife-owner-app
   ```

2. **ডিপেন্ডেন্সি ইনস্টল করো**
   ```bash
   npm install
   ```

3. **ডেভ সার্ভার চালু করো**
   ```bash
   npm run dev
   ```

4. **ব্রাউজারে খুলো**
   ```
   http://localhost:3000
   ```

5. **লগইন করো**
   - PIN: `1234` (বা `.env.local` এ যা সেট করেছো)

6. **Home ড্যাশবোর্ড দেখো**
   - নম্বরগুলি এখন তোমার Dental Sheets থেকে আসবে
   - **"Sample data" badge থাকবে না** (কারণ লাইভ ডেটা ব্যবহার করছো)

## যদি নম্বর না দেখা যায়

ব্রাউজারের DevTools Console খোলো (F12 > Console tab):

```
// এই কমান্ড দিয়ে দেখো কী আসছে
fetch('https://docs.google.com/spreadsheets/d/1Iq6TbeegQlOR7Z6-ojn4sSPdG379Owc1OiXhS0hXKso/export?format=csv&gid=0')
  .then(r => r.text())
  .then(t => console.log(t.split('\n')[0])) // হেডার দেখাবে
```

যদি 403 এরর আসে, মানে URL সঠিক নয়। তখন:
1. প্রতিটি ট্যাবে যাও
2. ব্রাউজার URL দেখো: `...#gid=12345`
3. সেই `12345` দিয়ে `.env.local` এ `gid` বদলে দে

## পরবর্তী ধাপ

✅ Local টেস্ট সফল হলে  
→ আমরা Physio sheet ও যোগ করব (দুটো scope সাপোর্ট করার জন্য)  
→ তারপর production এ ডিপ্লয় করব (env vars সহ)
