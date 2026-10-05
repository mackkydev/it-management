# IT-SYSTEM — ระบบงานฝ่าย IT

ระบบแจ้งงาน IT, คลังบัญชี/รหัสผ่าน, สัญญา vendor และทะเบียนสินทรัพย์ IT แบบ Decoupled —
**Next.js 16 (App Router) + Express.js 5 REST API + MySQL 8.4 + Prisma migrations** รองรับมือถือ
(Laravel API เดิมถูกถอดออกเมื่อ 4 ต.ค. 2569 — โค้ดเดิมดูได้จาก git history; ย้ายจาก PostgreSQL มา MySQL เมื่อ 5 ต.ค. 2569)

```
it-management/
├── express/            REST API — Express.js 5 + TypeScript + Prisma migrations (container it_express)
├── frontend/           Next.js 16 + Tailwind CSS 4 (รันบนเครื่อง)
├── storage/private/    ไฟล์แนบ / ลายเซ็น / ไฟล์ license (ไม่ขึ้น git — ต้องสำรองแยก)
├── docker/mysql/       init.sh: สร้างฐาน it_system_test / _shadow ให้ it_app (ครั้งแรกที่สร้าง volume)
├── docker/postgres/    init.sh ของฐาน PostgreSQL เดิม (profile legacy-postgres)
├── docker-compose.yml  it_mysql + it_express + it_adminer (+ it_postgres / it_mariadb เดิมเป็น profile)
└── database/           SQL สำหรับกรณีติดตั้ง MySQL เองโดยไม่ใช้ Docker
```

## ความต้องการของเครื่อง

- Docker Desktop (Compose v2) — Node (API) และ MySQL อยู่ใน container
- Node.js 20.9+ (ทดสอบด้วย 24) สำหรับ frontend

| Service | Container | พอร์ตบนเครื่อง |
|---|---|---|
| **Express API** | `it_express` | http://127.0.0.1:8020 (+ งานแจ้งเตือนใกล้หมดอายุทุกวัน 08:00 เวลาไทย) |
| **MySQL 8.4** | `it_mysql` | 127.0.0.1:3308 (user `it_app`, db `it_system`, collation `utf8mb4_0900_as_ci`) |
| Adminer | `it_adminer` | http://127.0.0.1:8081 (ระบบ MySQL, เซิร์ฟเวอร์ `mysql`, ผู้ใช้ `it_app`, ฐาน `it_system`) |
| PostgreSQL (เดิม) | `it_postgres` | ไม่เปิดตามปกติ — ข้อมูลก่อนย้าย: `docker compose --profile legacy-postgres up -d postgres` (127.0.0.1:5433) |
| MariaDB (เดิม) | `it_mariadb` | ไม่เปิดตามปกติ — `docker compose --profile legacy-mariadb up -d mariadb` (127.0.0.1:3307) |
| Next.js | (บนเครื่อง) | http://localhost:3000 |

> ใช้พอร์ต 8020/3308/8081 เพื่อไม่ชนกับ stack `system_*` ที่ใช้ 8000/3306/8080 อยู่แล้ว
> ทุกพอร์ต bind เฉพาะ 127.0.0.1 — เข้าได้จากเครื่องนี้เท่านั้น

---

## 1) Backend + Database (Docker) — รันที่ `E:\Claude_Jobs\it-management`

**ติดตั้งครั้งแรก** (ไม่ต้องใช้ PHP — โครงสร้างตารางและข้อมูลตั้งต้นมาจาก Prisma)

```powershell
cd E:\Claude_Jobs\it-management
Copy-Item express\.env.example express\.env       # แล้วใส่ APP_KEY, DB_PASSWORD, SEED_ADMIN_PASSWORD
docker compose up -d mysql express
docker compose exec express npx prisma migrate deploy   # สร้าง/อัปเดตตาราง
docker compose exec express npx prisma db seed          # สาขา + admin@example.com (รหัส = SEED_ADMIN_PASSWORD)
```

**ใช้งานประจำวัน**

```powershell
docker compose up -d                                      # เปิด
docker compose down                                       # ปิด (ข้อมูล DB อยู่ใน volume it-system_it_mysql)
docker compose exec mysql mysql -u it_app -p --default-character-set=utf8mb4 it_system   # เข้า MySQL console
docker compose exec mysql sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --single-transaction --default-character-set=utf8mb4 it_system' > backup.sql   # สำรองข้อมูล (+ สำรองโฟลเดอร์ storage/private)
docker compose logs -f express
```

**อีเมลแจ้งเตือน (SMTP)** — แก้ใน `express\.env` แล้ว `docker compose up -d express`

```env
MAIL_MAILER=smtp
MAIL_HOST=smtp.your-company.com
MAIL_PORT=587
MAIL_USERNAME=...
MAIL_PASSWORD=...
MAIL_SCHEME=null          # 465 ใช้ smtps
MAIL_FROM_ADDRESS=it-system@your-company.com
```

## Express API

รูปแบบข้อมูลเดิมจากยุค Laravel ยังคงไว้ (ข้อมูลที่มีอยู่ใช้ต่อได้): token แบบ Sanctum (`id|token`, sha256 ใน `personal_access_tokens`),
รหัสผ่าน bcrypt `$2y$`, ข้อมูลเข้ารหัสรูปแบบ `Crypt::encryptString` ด้วย `APP_KEY` (**ห้ามเปลี่ยน `APP_KEY`** — ถอดรหัสข้อมูลเดิมไม่ได้)

- ค่า env ทั้งหมดอยู่ใน `express/.env` — Docker ส่งค่าให้ผ่าน `env_file` และแทน `DB_HOST/DB_PORT` เป็น `mysql:3306`
  production ใช้ตัวแปร environment ของเซิร์ฟเวอร์แทนไฟล์ได้ (ตั้ง `SKIP_ENV_FILES=1`)

```powershell
docker compose up -d --build express                 # build/รัน Express
docker compose logs -f express
cd express; npm install; npm test                    # เทสต์ (ฐาน it_system_test สร้างใหม่จาก Prisma migrations ทุกครั้ง)
npm run dev                                          # รันบนเครื่อง (port 8020 — หยุด container ก่อน)
docker compose exec express node dist/cli/notify-expiring.js --dry-run   # ดูรายการที่จะแจ้งเตือน
```

### โครงสร้างฐานข้อมูล (Prisma migrations)

Prisma เป็นเจ้าของโครงสร้างตาราง (`express/prisma/schema.prisma` + `express/prisma/migrations`) — API เรียกฐานข้อมูลผ่าน `mysql2` (SQL ตรง ไม่ใช้ Prisma Client)
migration แรก `0_init` คือโครงสร้างทั้งหมด ณ วันที่ย้ายมา MySQL (ไฟล์ migration ของ PostgreSQL เดิมดูได้จาก git history)
— ส่วนที่ Prisma ไม่ได้ model (CHECK, unique index แบบ `LOWER(username)`, ลายเซ็นที่ใช้งานได้คนละ 1 อัน) เขียนต่อท้ายไฟล์เอง

| งาน | คำสั่ง (ใน `express/`) |
|---|---|
| เพิ่ม/แก้ตาราง (เครื่องพัฒนา) | แก้ `prisma/schema.prisma` → `npm run db:migrate -- --name add_xxx` (สร้างไฟล์ SQL + apply) |
| ใช้กับ production | `npx prisma migrate deploy` (apply เฉพาะ migration ที่ยังไม่ได้รัน — ไม่ลบข้อมูล) |
| ดูสถานะ | `npm run db:status` |
| ตรวจว่าฐานตรงกับ schema | `npm run db:validate` |
| ข้อมูลตั้งต้น | `npm run db:seed` (รันซ้ำได้ — ไม่เปลี่ยนรหัสผ่านผู้ใช้ที่มีอยู่) |

> ตรวจไฟล์ `migration.sql` ที่ Prisma สร้างทุกครั้งก่อน deploy (การลบ/เปลี่ยนชนิดคอลัมน์ทำให้ข้อมูลหายได้)
> เพิ่มคอลัมน์แล้วต้องแก้ query/resource ใน `express/src` ด้วย
> migration ที่ย้อนกลับได้มี `down.sql` ในโฟลเดอร์เดียวกัน (Prisma ไม่รันให้ — รันด้วย mysql client เอง)
> MySQL ไม่มี transaction ให้ DDL — migration ที่ล้มกลางทางต้องแก้ด้วยมือ จึงต้องทดสอบกับสำเนาฐานจริงก่อนเสมอ

ฐาน `it_system_test` (เทสต์) และ `it_system_shadow` (prisma migrate dev) ถูกสร้างอัตโนมัติโดย `docker/mysql/init.sh`

### ย้ายมาจาก PostgreSQL (ทำไปแล้ว 5 ต.ค. 2569)

ข้อมูลเดิมย้ายด้วย `express/scripts/migrate-from-postgres.ts` (ตรวจจำนวนแถวทุกตารางตรงกัน) — ฐาน PostgreSQL เดิมยังอยู่ใน volume `it-system_it_pg`
ถ้าต้องย้ายข้อมูลจากเครื่องอื่นที่ยังใช้ PostgreSQL:
```powershell
cd express; npx prisma migrate deploy
docker compose --profile legacy-postgres up -d postgres
$env:LEGACY_POSTGRES_URL = 'postgresql://it_app:รหัส@127.0.0.1:5433/it_system'; npm run db:import-postgres   # เพิ่ม -- --truncate เพื่อแทนที่ข้อมูลเดิม
```
(ก่อนหน้านั้นย้ายจาก MariaDB มา PostgreSQL เมื่อ 3 ต.ค. 2569 — สคริปต์เดิมดูได้จาก git history)

## 2) Frontend (Next.js) — รันที่ `E:\Claude_Jobs\it-management\frontend`

```powershell
cd E:\Claude_Jobs\it-management\frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

(`.env.local` ชี้ `API_URL=http://127.0.0.1:8020/api/v1` (Express); ถ้าพอร์ต 3000 ถูกใช้ ให้รัน `npm run dev -- -p 3001`)

**บัญชีตัวอย่าง** (รหัสผ่าน = `SEED_ADMIN_PASSWORD` ใน `express\.env`)

| อีเมล | บทบาท |
|---|---|
| `admin@example.com` | ผู้ดูแลระบบ |
| `it.head@example.com` | หัวหน้า IT (อนุมัติปิดงาน) |
| `it.staff@example.com` | เจ้าหน้าที่ IT (รับงาน/บันทึกผล) |
| `chief@example.com` | หัวหน้าแผนก (อนุมัติใบแจ้งของลูกทีม) |
| `staff@example.com` | พนักงาน (ผู้แจ้ง) — หัวหน้าคือ `chief@` |

Production: `npm run build` แล้ว `npm run start`

---

## ฟังก์ชันหลัก

### ใบแจ้งดำเนินงาน IT (`/tickets`)
- ประเภท: ซ่อม / ติดตั้ง / เพิ่มสิทธิ์ / ระงับสิทธิ์ / อื่นๆ (เลือกจากรายการที่ตั้งค่า เช่น "งานออกแบบ" หรือพิมพ์เอง)
- สาขาเลือกอัตโนมัติจากสังกัดผู้ใช้, เลือกเจ้าหน้าที่ IT ที่ต้องการ, วันที่ต้องการให้เสร็จ, ลายเซ็นผู้แจ้ง
- เพิ่ม/ระงับสิทธิ์ → ชื่อ-สกุล TH/EN · ซ่อม → อุปกรณ์, รหัสสินทรัพย์, อาการ + รูป ≤ 4 รูป (ย่อเหลือ ≤ 1MB อัตโนมัติ ถ่ายจากมือถือได้)
- แนบเอกสาร ≤ 5 ไฟล์ (PDF/Office/รูป ≤ 5MB)
- Workflow: `รอหัวหน้าอนุมัติ → อนุมัติแล้ว → IT รับงาน → บันทึกผล (รูป ≤ 4, อะไหล่ + รูป 1 รูป) → รอหัวหน้า IT อนุมัติ → เสร็จสิ้น`
  (ตีกลับ / ไม่อนุมัติพร้อมเหตุผลได้) — แจ้งเตือนในระบบทุกขั้น (กระดิ่งมุมบน) และพิมพ์ใบแจ้งตามแบบฟอร์มได้
- หลังบ้าน IT `/it/tickets`: รายการทั้งหมด + สถานะ + ปุ่มรับงาน · หัวหน้า `/tickets/approvals`
- หน้ารายละเอียดมีไทม์ไลน์ขั้นตอน (ไฮไลต์ขั้นที่กำลังดำเนินการ) · ผู้แจ้ง **แก้ไข/ลบ** ได้ก่อนหัวหน้าอนุมัติ (ไม่อนุมัติ = ลบได้)
- อนุมัติแล้วผู้แจ้งกด **ขอยกเลิก** (ระบุเหตุผล) → สถานะ `รอดำเนินการยกเลิก` + แจ้งเจ้าหน้าที่ IT ผู้รับงาน (ยังไม่มีผู้รับ = IT ทุกคน) → IT ยืนยัน (`ยกเลิกแล้ว`) หรือปฏิเสธ (กลับสถานะเดิม) · ผู้แจ้งถอนคำขอได้

### ข้อมูลแผนก IT (admin + เจ้าหน้าที่ IT)
- **คลังบัญชี/รหัสผ่าน** `/vault`: รหัสผ่านและข้อมูลลับเข้ารหัสใน DB (Laravel `encrypted` cast — กุญแจคือ `APP_KEY`),
  ไม่ถูกส่งมากับหน้าเว็บ ต้องกด "แสดง" (ซ่อนเองใน 30 วินาที) และ **บันทึก log ทุกครั้ง** ดูได้ในหน้าแก้ไข
- **สัญญา vendor** `/contracts`: วันเริ่ม/สิ้นสุด, ผู้ติดต่อ, กำหนดวันแจ้งเตือนล่วงหน้ารายสัญญา (หรือใช้ค่าเริ่มต้น)

### ตั้งค่า (admin)
- **สาขา** `/branches`: เพิ่ม / แก้ไข / ปิดใช้งาน / ลบ (ลบได้เมื่อไม่มีผู้ใช้หรือใบแจ้งงาน)
- **แจ้งเตือน** `/settings`: จำนวนวันแจ้งล่วงหน้า (สัญญา / บัญชี), อีเมลรับแจ้งเตือนหลายรายการ, ตัวเลือกเรื่อง "อื่นๆ"
- **ผู้ใช้งาน** `/users`: สาขา, ฝ่าย/แผนก, หัวหน้าตามสายบังคับบัญชา, เป็นเจ้าหน้าที่ IT / หัวหน้า IT

### สินทรัพย์ IT
- ทะเบียนสินทรัพย์ (รายการ/เพิ่ม/แก้ไข/รายละเอียด + timeline การโอนย้าย), ประวัติการโอนย้ายรวม, สถานที่

### บทบาท / ข้อมูลหลัก / โลโก้
- บทบาท: ผู้ดูแลระบบ · ผู้จัดการฝ่าย · ผู้จัดการ · เจ้าหน้าที่ IT (ติ๊กเจ้าหน้าที่ IT ให้อัตโนมัติ) · พนักงาน — สิทธิ์ของแต่ละบทบาทตั้งที่ `/role-permissions`
- **ฝ่าย** `/divisions` · **แผนก** `/departments` (สิทธิ์ `org.manage`): ฟอร์มผู้ใช้เลือกจากรายการนี้ · เปลี่ยนชื่อแล้วชื่อในข้อมูลผู้ใช้ (และสายอนุมัติ) เปลี่ยนตาม · ลบได้เมื่อไม่มีผู้ใช้
- **โลโก้ระบบ** (หน้า ตั้งค่าระบบ → การแจ้งเตือน): PNG/JPG/WebP ≤ 1MB แสดงหน้าชื่อ IT-SYSTEM ในเมนู — ไม่มีรูป = icon เดิม
- ปุ่ม "เพิ่ม" สินทรัพย์ / สถานที่ / ผู้ใช้ อยู่ที่หน้ารายการของแต่ละเมนู (ตั้งการมองเห็นที่หน้าสิทธิ์การใช้งาน → ปุ่ม)

### ผู้ใช้ 2 แบบ + สิทธิ์ (Local Admin)
- **LOCAL** = ผู้ใช้ของระบบเรา (อีเมล + รหัสผ่าน) · **API User** = login ผ่าน REST API ของระบบต้นทาง (ไม่เก็บรหัสผ่าน, สร้างบัญชีอัตโนมัติตอน login ครั้งแรก)
- **การเชื่อมต่อ API** `/api-connections`: endpoint, path ของ token/โปรไฟล์ (dot path), การ map ข้อมูล/บทบาท/error, การยืนยันตัวตน (secret เข้ารหัส),
  allowlist IP ภายใน (กัน SSRF), ลิงก์ลืม/เปลี่ยนรหัสผ่านที่ต้นทาง + ปุ่มทดสอบการเชื่อมต่อ — เปิดแล้วหน้า login มีแท็บของระบบนั้น
- **ผู้ใช้จาก API** `/api-users`: ค้นหา/กรองบทบาท สถานะ ระบบต้นทาง อีเมลซ้ำ · ปุ่ม "ผูกบัญชี" (อีเมลซ้ำกับบัญชี LOCAL เดิม) ·
  แก้บทบาท (ผู้จัดการ / ผู้ใช้งานทั่วไป) + สิทธิ์รายตัว (ตามบทบาท / อนุญาต / ไม่อนุญาต)
- **บันทึกการเปลี่ยนแปลง** `/audit-logs`: ใคร เมื่อไร ทำอะไร ค่าก่อน-หลัง IP (ไม่มี secret/token/รหัสผ่าน)
- **ซิงค์รายชื่อตามเวลา** (ตั้งที่การเชื่อมต่อ): สร้างผู้ใช้ล่วงหน้าเพื่อตั้งบทบาท/ลายเซ็นก่อน login ครั้งแรก, ปิดใช้งาน + ตัด session คนที่ถูกปิด/หายจากต้นทาง, ดึงไม่ได้หรือได้ 0 คน = ไม่ปิดใคร
- บัญชีในระบบ (LOCAL) login ด้วย **อีเมลหรือชื่อผู้ใช้** (ตั้ง username ที่หน้าแก้ไขผู้ใช้ — ไม่บังคับ, ห้ามมี @)
- Session ของ API User: ไม่ใช้งานเกิน 30 นาที (`API_SESSION_IDLE_MINUTES`) ต้อง login ใหม่ · อายุไม่เกิน token ต้นทาง · ตรวจสถานะกับต้นทางทุก 10 นาที

## หน้าจอและการแสดงผล

- เมนูแถบข้าง (ย่อเหลือ icon + tooltip ได้) หรือแถบบน · มือถือใช้ลิ้นชักเมนู
- โหมด สว่าง / มืด / ตามระบบ · ธีม pastel 5 แบบ + เลือกสีเอง · ภาษา ไทย / English
- สีสถานะ (`success / info / warning / danger / idle`) เปลี่ยนตามธีมเพื่อไม่ให้ซ้ำกับสีธีม
- เพิ่มข้อความแปล: `frontend/src/i18n/th.ts` (ต้นแบบ) และ `en.ts` — TypeScript จะแจ้งถ้า key ไม่ครบ

## API (v1)

ทุก endpoint (ยกเว้น login) ต้องส่ง `Authorization: Bearer <token>` · ภาษาของข้อความตาม header `Accept-Language`

| Method | Path | สิทธิ์ | หมายเหตุ |
|---|---|---|---|
| POST | `/auth/login` | - | `email`, `password`, `device_name` → `token` (5 ครั้ง/นาที) |
| GET / PATCH | `/auth/me` | ทุกคน | |
| PUT | `/auth/password` | ทุกคน | เพิกถอน token อุปกรณ์อื่น |
| GET / POST / PATCH / DELETE | `/kpi[/{id}]` | ฝ่าย IT | บันทึก KPI ของตัวเอง (admin / หัวหน้า IT ดูของทุกคน: `user_id`, `from`, `to`) |
| GET / POST / PUT / DELETE | `/approval-routes[/{id}]` | admin | สายอนุมัติใบแจ้งงาน: `name, branch_id, department, is_active, steps:[{name, approver_ids:[]}]` (1–5 ขั้น, ขั้นละ 1–20 คน) |
| GET | `/approval-routes/resolve?user_id=` | ทุกคน (ของคนอื่น = admin) | แผนอนุมัติของผู้ใช้: `source` (user/branch_department/branch/department/default/legacy), `steps`, `legacy_approver` |
| GET | `/approval-routes/departments` | admin | รายชื่อแผนกที่มีในข้อมูลผู้ใช้ |
| GET | `/ui-config` | ทุกคน | การมองเห็นเมนู/ปุ่ม + ลำดับเมนู (แก้ผ่าน `PUT /settings` คีย์ `ui_permissions`, `menu_order` — admin) |
| GET / POST / PUT / DELETE | `/auth/me/signature` | `signature.manage_own` (ตั้งต้นทุกคน) | ลายเซ็นของฉัน (multipart `signature`: PNG/JPG ≤ 1MB, `source`: UPLOAD|DRAW) — crop + ย่อ ≤ 600px + re-encode PNG, เก็บเข้ารหัส, อันเดิมเป็นประวัติ · 10 ครั้ง/นาที |
| DELETE | `/users/{id}/signature` | Local Admin | ลบ (ปิดใช้งาน) ลายเซ็นของผู้ใช้ + audit |
| GET | `/tickets?scope=mine\|approvals\|it` | ทุกคน | ตาม scope ที่มีสิทธิ์ + `counts` |
| GET | `/tickets/form-options` | ทุกคน | สาขา, เจ้าหน้าที่ IT, ตัวเลือก "อื่นๆ" |
| POST | `/tickets` | ทุกคน | multipart: `photos[]` ≤ 4 (1MB), `documents[]` ≤ 5 (5MB) — ลายเซ็นผู้แจ้งคัดลอกจากโปรไฟล์ ณ ตอนแจ้ง (ส่ง `signature` data URL PNG มาแทนได้) |
| GET | `/tickets/{uuid}` | ผู้เกี่ยวข้อง | |
| POST | `/tickets/{uuid}/approve` \| `reject` | ผู้อนุมัติขั้นปัจจุบัน (สายอนุมัติ) / หัวหน้าตามสาย (ระบบเดิม) / admin | reject ต้องมี `comment` — สายอนุมัติ: approve ส่งต่อขั้นถัดไปจนครบจึงเป็น `approved` (detail มี `current_step`, `approval_steps`) |
| POST | `/tickets/{uuid}/accept` \| `result` | เจ้าหน้าที่ IT | result: multipart + `parts[]` |
| POST | `/tickets/{uuid}/progress` | เจ้าหน้าที่ IT ผู้รับงาน / หัวหน้า IT | บันทึกความคืบหน้า `comment` (จำเป็น) ระหว่างสถานะ in_progress — ขึ้นไทม์ไลน์ + แจ้งผู้แจ้ง ไม่เปลี่ยนสถานะ |
| POST | `/tickets/{uuid}/close` \| `return` | หัวหน้า IT | |
| GET | `/tickets/{uuid}/files/{kind}/{id}` | ผู้เกี่ยวข้อง | ไฟล์ใน private disk |
| GET/POST/PATCH/DELETE | `/credentials[/{id}]` | IT, admin | ไม่ส่งรหัสผ่านใน response |
| POST | `/credentials/{id}/reveal` | IT, admin | บันทึก log (30 ครั้ง/นาที) |
| GET | `/credentials/{id}/logs` | IT, admin | |
| GET/POST/PATCH/DELETE | `/contracts[/{id}]` | IT, admin | `status=active\|expiring\|expired`, `search` |
| GET/POST/PATCH/DELETE | `/branches[/{id}]` | อ่าน: ทุกคน · แก้: admin | |
| GET / PUT | `/settings` | admin | |
| GET | `/notifications` · POST `/notifications/{id}/read` · `/notifications/read-all` | ทุกคน | |
| GET/POST/PATCH/DELETE | `/assets`, `/locations`, `/users`, `/movements` | ตามบทบาท | (ชุดเดิมของทะเบียนสินทรัพย์) — หมวด `SOFTWARE` ต้องส่ง `license:{billing: yearly\|custom\|perpetual, start_date, expires_at, seats, vendor, license_key, clear_license_key, notify_days_before}` (key เข้ารหัส ไม่ส่งกลับ; ว่าง = คงเดิม) |
| GET | `/license-installations?license_id=&status=active\|removed\|all&branch_id=&search=` | ผู้จัดการสินทรัพย์ / ฝ่าย IT | การติดตั้ง license (+ `usage: {seats, used, available}` เมื่อระบุ license_id) |
| GET | `/license-installations/licenses` | ผู้จัดการสินทรัพย์ / ฝ่าย IT | license ทั้งหมด + จำนวนที่ใช้/คงเหลือ |
| POST | `/license-installations` | ผู้จัดการสินทรัพย์ / ฝ่าย IT | `{license_id, device_asset_id \| device_name, user_id, branch_id, installed_at, notes}` — บันทึกเกินจำนวน seat ไม่ได้ |
| POST / DELETE | `/license-installations/{id}/uninstall`, `/license-installations/{id}` | ผู้จัดการสินทรัพย์ / ฝ่าย IT | ถอนการติดตั้ง (คืน seat, เก็บประวัติ) / ลบรายการที่บันทึกผิด |
| GET | `/announcements/public` | **ไม่ต้อง login** | ประกาศหน้า login ที่เปิดอยู่และอยู่ในช่วงวันที่ (≤ 5) |
| GET | `/sync/version` | ทุกคน | ลายนิ้วมือข้อมูล (COUNT+MAX(updated_at) ของตารางหลัก + การแจ้งเตือนของผู้ใช้) — frontend `<LiveRefresh>` ถามทุก 10 วินาทีแล้ว refresh หน้าเมื่อเปลี่ยน |
| GET | `/auth/connections` | **ไม่ต้อง login** | ช่องทาง login ผ่านระบบต้นทางที่เปิดอยู่ `{id, name, register_url, forgot_password_url}` |
| POST | `/auth/api-login` | **ไม่ต้อง login** (5 ครั้ง/นาที) | `{connection_id, username, password, device_name}` → login ที่ต้นทาง + JIT สร้าง/อัปเดต API User → token ของเรา (รูปแบบเดียวกับ `/auth/login`) |
| GET / POST / PUT / PATCH / DELETE | `/api-connections[/{id}]` | Local Admin | ตั้งค่าการเชื่อมต่อ REST API ต้นทาง (secret เข้ารหัส ไม่ส่งกลับ, ทุกการแก้ไขลง `audit_logs`) — ลบได้เมื่อยังไม่มีผู้ใช้ |
| POST | `/api-connections/{id}/test` | Local Admin | `{username, password}` ลอง login จริงแล้วแสดงผลการ map (ไม่คืน token / ไม่สร้างผู้ใช้) |
| POST | `/api-connections/{id}/sync` | Local Admin | ซิงค์รายชื่อผู้ใช้จากต้นทางตอนนี้ (ตามเวลา: `sync_interval_minutes`, scheduler ตรวจทุก 5 นาที) — สร้างล่วงหน้า / ปิดคนที่ถูกปิดหรือหายจากต้นทาง + ตัด session / เปิดคืนเฉพาะที่ซิงค์ปิด |
| GET | `/permissions` | Local Admin | รายการสิทธิ์ + สิทธิ์ของแต่ละกลุ่ม |
| PUT | `/permissions/roles/{group}` | Local Admin | `{keys: [...]}` กำหนดสิทธิ์ทั้งชุดของบทบาท / it_staff / it_head |
| GET / POST / PUT / DELETE | `/departments[/{id}]`, `/divisions[/{id}]` | อ่าน: ทุกคน · แก้: `org.manage` | แผนก / ฝ่าย (`?include_inactive=1` = ทั้งหมด + จำนวนผู้ใช้) |
| GET | `/branding/logo` | **ไม่ต้อง login** | รูปโลโก้ระบบ (ไม่มี = 404) |
| POST / DELETE | `/settings/logo` | `settings.manage` | อัปโหลด (multipart `logo`, PNG/JPG/WebP ≤ 1MB) / ลบโลโก้ |
| GET / PUT | `/users/{id}/permissions` | Local Admin | สิทธิ์จากกลุ่ม + เพิ่ม/ถอดรายคน + สิทธิ์จริง · PUT `{role? (API User: manager\|viewer), overrides: {key: allow\|deny\|inherit}}` |
| GET | `/api-users` | Local Admin | `?search=&role=&status=&connection_id=&conflict=1` รายการ API User |
| POST | `/api-users/{id}/link` | Local Admin | `{local_user_id}` ผูก API User กับบัญชี LOCAL เดิม (บัญชีเดิมใช้รหัสผ่านเดิมไม่ได้อีก; ห้ามผูกกับ admin) |
| GET | `/audit-logs`, `/audit-logs/actions` | Local Admin | `?action=&subject_type=&subject_id=&actor_id=&from=&to=` บันทึกการเปลี่ยนแปลง |
| GET / POST / PUT / DELETE | `/announcements[/{id}]` | admin / ฝ่าย IT | จัดการประกาศ `{title, body, level: info\|warning\|danger, is_active, starts_on, ends_on, sort_order}` |
| GET | `/assets/suggestions?field=brand\|model&q=&brand=` | ทุกคน | ยี่ห้อ/รุ่นที่มีอยู่ (ไม่ซ้ำ ไม่สนตัวพิมพ์, รุ่นกรองตามยี่ห้อ) |
| POST | `/assets/{uuid}/license-key` | ผู้จัดการสินทรัพย์ / ฝ่าย IT | ดู license key (จำกัด 30 ครั้ง/นาที) |
| POST / GET / DELETE | `/assets/{uuid}/files[/{id}]` | เพิ่ม/ลบ = ผู้จัดการสินทรัพย์, ดู = ทุกคน | ไฟล์ license: multipart `files[]` ≤ 10 ไฟล์ (≤ 10MB: pdf, ข้อความ .lic/.key/.txt/.xml, รูป, Office, zip); GET แสดงในเบราว์เซอร์ (pdf/รูป/ข้อความ) หรือ `?download=1` |

## Security ที่ทำไว้

- **Token ไม่ถึง browser**: Next.js เรียก API จากฝั่ง server และเก็บ token ใน cookie `httpOnly` + `sameSite=lax` + `secure` (production)
- **ไฟล์แนบ** อยู่ใน private disk ชื่อไฟล์สุ่ม เปิดผ่าน proxy ที่ตรวจสิทธิ์รายใบงาน; ลายเซ็นตรวจรูปแบบ PNG และขนาด
- **รหัสผ่านในคลัง** เข้ารหัสด้วย `APP_KEY` — **สำรอง `APP_KEY` ไว้เสมอ** ถ้าหายจะถอดรหัสข้อมูลเดิมไม่ได้
- Policies/Gates ทุก endpoint, FormRequest validation, rate limiting, UUID ใน URL, soft delete, security headers, CORS จำกัด origin
- DB user `it_app` แยกสิทธิ์เฉพาะฐาน `it_system`
