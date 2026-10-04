# IT-SYSTEM — กฎการพัฒนา (Claude Code)

ระบบงานฝ่าย IT (ใบแจ้งงาน IT, คลังบัญชี/รหัสผ่าน, สัญญา vendor, สินทรัพย์ IT):
**Next.js 16 (App Router) + Express.js 5 API (หลัก) / Laravel 13 API (สำรอง) + PostgreSQL 17** — รันบน Docker (`docker compose up -d`)
- Container: `it_express` (8020, API หลัก + scheduler), `it_api` (8010, Laravel), `it_postgres` (5433, db `it_system`, user `it_app`), `it_adminer` (8081)
- MariaDB เดิมเก็บเป็นสำรอง (profile `legacy-mariadb`, volume `it-system_it_db`) — ไม่ใช้งานแล้ว
- `it_scheduler` (Laravel) ปิดไว้ด้วย profile `laravel-scheduler` — ห้ามเปิด scheduler ทั้งสองฝั่งพร้อมกัน
- ชื่อภายในเดิมที่ตั้งใจคงไว้: cookie `eam_*`, `config/eam.php`, `lang/{th,en}/eam.php`, `EAM_TOKEN_TTL_MINUTES`

## ทั่วไป
- ตอบผู้ใช้เป็นภาษาไทย; โค้ด/ชื่อตัวแปรเป็นภาษาอังกฤษ
- แก้เฉพาะขอบเขตที่ขอ + ไฟล์ที่เกี่ยวข้องโดยตรง; ปัญหานอกขอบเขตให้รายงาน ไม่แก้เอง
- ไฟล์ที่มีภาษาไทย ห้ามใช้ PowerShell `Get-Content`/`Set-Content` แก้ไข — ใช้ Read/Edit/Write
- หลังแก้ ต้องผ่าน: `npm test` + `npx tsc --noEmit` (ใน `express/`), `php artisan test` (ใน container `it_api`), `npm run lint`, `npx tsc --noEmit`, `npm run build` (ใน `frontend/`)

## การถามผู้ใช้ (ลดการรอคำตอบ)
- เรื่องที่มีทางเลือก "แนะนำ" ชัดเจนและย้อนกลับได้ (ชื่อ, รูปแบบ UI, ค่าเริ่มต้น, โครงสร้างโค้ด) → **เลือกตัวที่แนะนำแล้วทำต่อทันที ไม่ต้องถาม** แล้วแจ้งในสรุปว่าเลือกอะไร
- ถามและรอคำตอบเฉพาะเรื่องที่ย้อนกลับยากหรือกระทบภายนอก: ลบข้อมูลจริง, push/deploy, เปลี่ยน secret/สิทธิ์, ค่าใช้จ่าย, ความกำกวมที่ทำให้งานผิดทั้งหมด
- (Claude หยุดรอเมื่อถามคำถาม — ไม่มีการนับเวลาแล้วเลือกเอง จึงต้องเลี่ยงการถามตั้งแต่แรกตามกฎข้อบน)

## งานค้าง / ทำงานต่ออัตโนมัติ
- คิวงานค้างอยู่ที่ `.claude/pending-work.md` — งานตั้งเวลา `it-system-resume-pending-work` (ทุก 1 ชม. ขณะเปิดแอป Claude) ทำต่อทีละรายการ
- ถ้างานยังไม่เสร็จแล้วต้องหยุด (เช่น ใกล้ชน limit โควตา, รอผู้ใช้ตอบ) ให้เขียนสิ่งที่เหลือเป็น `- [ ]` ในคิวก่อนจบ
  พร้อมรายละเอียดครบในตัว (ไฟล์ที่เกี่ยวข้อง, ทำถึงไหนแล้ว, เกณฑ์ว่าเสร็จ) — รอบตั้งเวลาไม่เห็นบทสนทนาเดิม
- รอบที่รันจากการตั้งเวลา: ไม่มี `- [ ]` → จบทันที; ห้าม commit/push/deploy/ลบข้อมูลจริง; สิ่งที่ต้องให้ผู้ใช้ตัดสินใจ → ทำเครื่องหมาย `- [!]` แล้วข้าม

## สิทธิ์การมองเห็นเมนู/ปุ่ม (หน้า ตั้งค่าระบบ → สิทธิ์การใช้งาน)
- ตั้งค่าเก็บใน `app_settings`: `ui_permissions` (key → กลุ่มที่ซ่อน) และ `menu_order` — โค้ดกลางอยู่ที่ `frontend/src/lib/permissions.ts`
- key เมนู = `href` ของเมนูใน `components/shell/nav.ts`, key ปุ่ม = `btn:<หน้า>:<ปุ่ม>` (**ห้ามมีจุด** — validator ของ API ใช้จุดแยก path)
- เพิ่มเมนูใหม่: ใส่ใน `NAV` แล้วจะขึ้นในหน้าสิทธิ์อัตโนมัติ; เพิ่มปุ่มใหม่: เพิ่มใน `BUTTONS` แล้วครอบปุ่มด้วย `(await getAccess())("btn:...")`
- เป็นการซ่อนเพิ่มจากสิทธิ์เดิมเท่านั้น — สิทธิ์จริงต้องตรวจที่ API เสมอ

## API: Express ↔ Laravel ต้องเหมือนกันเสมอ
- แก้/เพิ่ม endpoint ต้องทำ **ทั้งสองฝั่ง** ให้ path, JSON, สิทธิ์, ข้อความ th/en ตรงกัน (Express: `express/src/routes`, ข้อความ `express/src/lib/i18n.ts` ↔ `backend/lang`)
- **โครงสร้างฐานข้อมูลเป็นของ Prisma migrations** (`express/prisma/`) — เพิ่ม/แก้ตาราง: แก้ `schema.prisma` → `npm run db:migrate -- --name <ชื่อ>` (ใน `express/`)
  - **ห้ามรัน `php artisan migrate`** กับฐานจริง (baseline `0_init` = โครงสร้างจาก Laravel migration เดิมทั้งหมด)
  - ข้อยกเว้นเดียว: Laravel migration ที่เป็น "สำเนาเพื่อฐานเทสต์ SQLite ของ Laravel" ของ Prisma migration — ต้องมี guard `Schema::hasColumn/hasTable` (รันกับฐานจริงแล้วไม่ทำอะไร) และ `down()` ว่าง
  - ห้ามแก้ไฟล์ migration ที่ deploy แล้ว — สร้าง migration ใหม่เสมอ; ข้อมูลตั้งต้นอยู่ที่ `express/src/cli/seed.ts`
  - Prisma ใช้จัดการ schema เท่านั้น — API เรียกฐานข้อมูลผ่าน pg (`src/db.ts`) เพิ่มคอลัมน์แล้วต้องแก้ query/resource ที่เกี่ยวข้องด้วย
- SQL ใน Express เป็น PostgreSQL: placeholder `?` (db.ts แปลงเป็น $n ให้), ชื่อคอลัมน์ใช้ `"..."`, boolean ใช้ `true/false`,
  ค้นหาข้อความใช้ `ILIKE` (ไม่สนตัวพิมพ์), ตรวจรูปแบบ uuid ด้วย `isUuid()` ก่อน query คอลัมน์ uuid
  - Laravel (ตัวสำรอง) ค้นหาด้วย `whereLike()` เท่านั้น (ไม่ใช่ `'like'` ซึ่งสนตัวพิมพ์บน PostgreSQL)
- ค่า env ของ Express อยู่ใน `express/.env` (ไม่พึ่ง `backend/.env`) — `APP_KEY`/`DB_*` ต้องตรงกับ Laravel ถ้ายังใช้ Laravel เป็นตัวสำรอง
- ห้ามเปลี่ยนรูปแบบ token (Sanctum), bcrypt `$2y$`, การเข้ารหัส `APP_KEY` และ path ไฟล์ใน `storage/app/private` — ใช้ร่วมกันทั้งสองฝั่ง
- เทสต์ Express ใช้ฐาน `it_system_test` เท่านั้น (บังคับใน `vitest.config.ts` + `tests/setup.ts`) — ห้ามชี้เทสต์ไปที่ `it_system`
- งานแต่ละประเภทมี agent เฉพาะทางใน `.claude/agents/` — ใช้เมื่องานใหญ่หรือต้องการความเชี่ยวชาญเฉพาะ

## UI / Frontend (บังคับ)
- **ทุกอย่างที่กดด้วยเมาส์ได้ ต้องมี `cursor-pointer`** — ปุ่ม, ลิงก์, แท็บ, swatch, ตัวเลือก dropdown, label ของ checkbox/radio, แถวที่คลิกได้
  - ใช้ `btn.*` จาก `components/ui.ts` (มี `cursor-pointer` อยู่แล้ว) หรือใส่ class `cursor-pointer` เอง
  - สถานะ disabled ใช้ `disabled:cursor-not-allowed`
  - `globals.css` มีกฎ base เป็นตาข่ายรองรับ แต่ **ต้องใส่ class ในคอมโพเนนต์ด้วยเสมอ**
- Tooltip ใช้ `<Tooltip>` จาก `components/tooltip.tsx` เท่านั้น — **ห้ามใช้ attribute `title`** (สไตล์ไม่สวยและไม่ตรงธีม)
- สีใช้ token เท่านั้น ห้าม hard-code ชื่อสี Tailwind ในหน้าเว็บ:
  - สีธีม: `accent-*` · สีพื้น/ตัวอักษร: `canvas / surface / subtle / line / ink / muted / faint`
  - สีสถานะ: `success / info / warning / danger / idle` (เปลี่ยนตามธีมอัตโนมัติ ไม่ให้ซ้ำกับสีธีม)
  - ยกเว้น: error ใต้ช่องกรอกใช้ `inputError` + `text-red-500` (มาตรฐานฟอร์ม)
- รองรับโหมดมืดทุกหน้า (`dark:` variant) และ responsive (ตารางบนจอใหญ่ / การ์ดบนมือถือ)
- ข้อความทุกจุดผ่าน i18n: `src/i18n/th.ts` (ต้นแบบ) + `en.ts` — ห้าม hard-code ข้อความในคอมโพเนนต์
- ทุกหน้าที่โหลดข้อมูลต้องมี `loading.tsx` หรือ `<Suspense>` + skeleton; ปุ่มที่ส่งข้อมูลต้องแสดง spinner
- ฟอร์ม: error ใต้ช่องสีแดง + ล้าง error ของช่องทันทีเมื่อผู้ใช้แก้
- เรียก API ผ่าน `apiFetch` (server-side) เท่านั้น — token อยู่ใน httpOnly cookie ห้ามส่งไป browser
- Next.js 16 มี breaking changes — อ่าน `frontend/node_modules/next/dist/docs/` ก่อนใช้ API ที่ไม่แน่ใจ (เช่น `proxy.ts` แทน middleware)

## Backend (Laravel)
- ทุก endpoint อยู่ใต้ `/api/v1`, ตรวจสิทธิ์ด้วย Policy (`Gate::authorize`) + FormRequest
- ข้อความ validation/สถานะแปลผ่าน `lang/{th,en}` ตาม `Accept-Language`
- ข้อมูล audit (เช่น `asset_movements`) ห้ามแก้/ลบผ่าน API; ลบข้อมูลหลักใช้ soft delete หรือบังคับปิดใช้งานแทนถ้ามีประวัติ
- Migration ของ Laravel หยุดใช้แล้ว (ดู Prisma ด้านบน) — ห้ามแก้หรือเพิ่มใน `backend/database/migrations`
- `role` / `is_active` ของผู้ใช้ไม่อยู่ใน `$fillable` (กันยกระดับสิทธิ์) — กำหนดผ่าน `forceFill` ในจุดที่ admin เท่านั้น
- ห้ามใส่ `DB_*` ใน `environment:` ของ docker-compose (จะทับ `phpunit.xml` แล้วเทสต์ล้างฐานข้อมูลจริง)
