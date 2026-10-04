# IT-SYSTEM — ระบบงานฝ่าย IT

ระบบแจ้งงาน IT, คลังบัญชี/รหัสผ่าน, สัญญา vendor และทะเบียนสินทรัพย์ IT แบบ Decoupled —
**Next.js 16 (App Router) + Express.js 5 REST API (Laravel 13 สำรอง) + PostgreSQL 17 + Prisma migrations** รองรับมือถือ

```
it-management/
├── express/            REST API หลัก — Express.js 5 + TypeScript + Prisma migrations (container it_express)
├── backend/            Laravel 13 API สำรอง (container it_api) — migration เดิมหยุดใช้แล้ว
├── frontend/           Next.js 16 + Tailwind CSS 4 (รันบนเครื่อง)
├── docker/php/         Dockerfile: PHP 8.3 + Composer 2 + pdo_pgsql/intl/zip/opcache/bcmath/gd
├── docker/postgres/    init.sh: สร้างผู้ใช้ it_app + ฐาน it_system / _test / _shadow (ครั้งแรกที่สร้าง volume)
├── docker-compose.yml  it_postgres + it_express + it_api + it_adminer (+ it_scheduler / it_mariadb เป็น profile)
├── database/           SQL สำหรับกรณีติดตั้ง PostgreSQL เองโดยไม่ใช้ Docker
└── scripts/            สคริปต์ติดตั้ง backend (Docker: .sh / ไม่ใช้ Docker: .ps1)
```

## ความต้องการของเครื่อง

- Docker Desktop (Compose v2) — Node (API), PostgreSQL, PHP (ตัวสำรอง) อยู่ใน container ทั้งหมด
- Node.js 20.9+ (ทดสอบด้วย 24) สำหรับ frontend

| Service | Container | พอร์ตบนเครื่อง |
|---|---|---|
| **Express API (หลัก)** | `it_express` | http://127.0.0.1:8020 (+ งานแจ้งเตือนใกล้หมดอายุทุกวัน 08:00 เวลาไทย) |
| Laravel API (สำรอง) | `it_api` | http://127.0.0.1:8010 |
| Laravel scheduler | `it_scheduler` | ปิดไว้ (profile `laravel-scheduler`) — Express รันงานแจ้งเตือนแทน |
| **PostgreSQL 17** | `it_postgres` | 127.0.0.1:5433 (user `it_app`, db `it_system`) |
| Adminer | `it_adminer` | http://127.0.0.1:8081 (ระบบ PostgreSQL, เซิร์ฟเวอร์ `postgres`, ผู้ใช้ `it_app`, ฐาน `it_system`) |
| MariaDB (เดิม) | `it_mariadb` | ไม่เปิดตามปกติ — สำรองข้อมูลเดิม: `docker compose --profile legacy-mariadb up -d mariadb` (127.0.0.1:3307) |
| Next.js | (บนเครื่อง) | http://localhost:3000 |

> ใช้พอร์ต 8010/8020/5433/8081 เพื่อไม่ชนกับ stack `system_*` ที่ใช้ 8000/3306/8080 อยู่แล้ว
> ทุกพอร์ต bind เฉพาะ 127.0.0.1 — เข้าได้จากเครื่องนี้เท่านั้น

---

## 1) Backend + Database (Docker) — รันที่ `E:\Claude_Jobs\it-management`

**ติดตั้งครั้งแรก** (ไม่ต้องใช้ PHP — โครงสร้างตารางและข้อมูลตั้งต้นมาจาก Prisma)

```powershell
cd E:\Claude_Jobs\it-management
Copy-Item express\.env.example express\.env       # แล้วใส่ APP_KEY, DB_PASSWORD, SEED_ADMIN_PASSWORD
docker compose up -d postgres express
docker compose exec express npx prisma migrate deploy   # สร้าง/อัปเดตตาราง
docker compose exec express npx prisma db seed          # สาขา + admin@example.com (รหัส = SEED_ADMIN_PASSWORD)
```

ถ้าต้องการ Laravel เป็นตัวสำรองด้วย: `docker compose run --rm -v ./scripts:/scripts api sh /scripts/setup-backend-docker.sh`
แล้ว `docker compose up -d api` (ใช้ `APP_KEY`/`DB_*` ค่าเดียวกับ `express/.env` — **ห้ามรัน `php artisan migrate`**)

**ใช้งานประจำวัน**

```powershell
docker compose up -d                                      # เปิด
docker compose down                                       # ปิด (ข้อมูล DB อยู่ใน volume it-system_it_pg)
docker compose exec api php artisan test                  # เทสต์ (SQLite in-memory ไม่แตะ DB จริง)
docker compose exec api php artisan it:notify-expiring --dry-run   # ดูรายการที่จะแจ้งเตือน (ไม่ส่งจริง)
docker compose exec postgres psql -U it_app -d it_system  # เข้า PostgreSQL console
docker compose exec postgres pg_dump -U it_app it_system > backup.sql   # สำรองข้อมูล
docker compose logs -f api scheduler
```

> ห้ามใส่ `DB_*` เป็น `environment:` ใน docker-compose.yml — ค่าจาก env ของ container จะมีลำดับเหนือ `phpunit.xml`
> ทำให้ `php artisan test` ไปล้างฐานข้อมูลจริง ให้แก้ค่าใน `backend\.env` แทน

**อีเมลแจ้งเตือน (SMTP)** — แก้ใน `backend\.env` แล้ว `docker compose restart api scheduler`

```env
MAIL_MAILER=smtp
MAIL_HOST=smtp.your-company.com
MAIL_PORT=587
MAIL_USERNAME=...
MAIL_PASSWORD=...
MAIL_SCHEME=null          # 465 ใช้ smtps
MAIL_FROM_ADDRESS=it-system@your-company.com
```

ขณะ `MAIL_MAILER=log` อีเมลจะถูกเขียนลง `backend/storage/logs/laravel.log` แทนการส่งจริง

## Express API (หลัก) กับ Laravel (สำรอง)

Express (`express/`) ทำ endpoint ครบทุกตัวเหมือน Laravel — path, JSON, สิทธิ์, ข้อความ validation th/en, rate limit
และใช้ **ฐานข้อมูล / token / ไฟล์แนบชุดเดียวกัน** จึงสลับกันได้ทันทีโดยแก้ `API_URL` ใน `frontend\.env.local` แล้ว restart Next.js

| สิ่งที่ใช้ร่วมกัน | วิธีที่ทำให้เข้ากันได้ |
|---|---|
| Token | รูปแบบ Sanctum (`id|token`, sha256 ในตาราง `personal_access_tokens`) — login ฝั่งไหนก็ใช้กับอีกฝั่งได้ |
| รหัสผ่านผู้ใช้ | bcrypt `$2y$` (cost ตาม `BCRYPT_ROUNDS`) |
| คลังรหัสผ่าน | AES-256-CBC + MAC รูปแบบ `Crypt::encryptString` ด้วย `APP_KEY` เดียวกัน |
| ไฟล์แนบ/ลายเซ็น | โฟลเดอร์ `backend/storage/app/private` (mount เข้า container ทั้งสอง) |
| แจ้งเตือน / ตั้งค่า | ตาราง `notifications`, `app_settings` รูปแบบเดียวกัน (ล้าง cache ของ Laravel เมื่อแก้) |

- ค่า env ทั้งหมดของ Express อยู่ใน `express/.env` (ไม่พึ่ง `backend/.env`) — Docker ส่งค่าให้ผ่าน `env_file` และแทน `DB_HOST/DB_PORT` เป็น `postgres:5432`
  production ใช้ตัวแปร environment ของเซิร์ฟเวอร์แทนไฟล์ได้ (ตั้ง `SKIP_ENV_FILES=1`)
- ถ้ายังใช้ Laravel เป็นตัวสำรอง `APP_KEY` และ `DB_*` ใน `express/.env` กับ `backend/.env` ต้องตรงกันเสมอ

```powershell
docker compose up -d --build express                 # build/รัน Express
docker compose logs -f express
cd express; npm install; npm test                    # เทสต์ (ฐาน it_system_test สร้างใหม่จาก Prisma migrations ทุกครั้ง)
npm run dev                                          # รันบนเครื่อง (port 8020 — หยุด container ก่อน)
docker compose exec express node dist/cli/notify-expiring.js --dry-run   # ดูรายการที่จะแจ้งเตือน
```

### โครงสร้างฐานข้อมูล (Prisma migrations)

Prisma เป็นเจ้าของโครงสร้างตาราง (`express/prisma/schema.prisma` + `express/prisma/migrations`) — API เรียกฐานข้อมูลผ่าน `pg` (SQL ตรง ไม่ใช้ Prisma Client)
migration แรก `0_init` คือโครงสร้างเดียวกับที่ Laravel เคยสร้าง (แปลงเป็น PostgreSQL + index trigram สำหรับค้นหา)

| งาน | คำสั่ง (ใน `express/`) |
|---|---|
| เพิ่ม/แก้ตาราง (เครื่องพัฒนา) | แก้ `prisma/schema.prisma` → `npm run db:migrate -- --name add_xxx` (สร้างไฟล์ SQL + apply) |
| ใช้กับ production | `npx prisma migrate deploy` (apply เฉพาะ migration ที่ยังไม่ได้รัน — ไม่ลบข้อมูล) |
| ดูสถานะ | `npm run db:status` |
| ตรวจว่าฐานตรงกับ schema | `npm run db:validate` |
| ข้อมูลตั้งต้น | `npm run db:seed` (รันซ้ำได้ — ไม่เปลี่ยนรหัสผ่านผู้ใช้ที่มีอยู่) |

> **ห้ามเพิ่ม Laravel migration และห้ามรัน `php artisan migrate` อีก** — จะชนกับ Prisma
> ตรวจไฟล์ `migration.sql` ที่ Prisma สร้างทุกครั้งก่อน deploy (การลบ/เปลี่ยนชนิดคอลัมน์ทำให้ข้อมูลหายได้)
> เพิ่มคอลัมน์แล้วต้องแก้ query/resource ใน `express/src` ด้วย (และ Laravel ถ้ายังใช้เป็นตัวสำรอง)

ฐาน `it_system_test` (เทสต์) และ `it_system_shadow` (prisma migrate dev) ถูกสร้างอัตโนมัติโดย `docker/postgres/init.sh`

### ย้ายมาจาก MariaDB (ทำไปแล้ว 3 ต.ค. 2569)

ข้อมูลเดิมย้ายด้วย `express/scripts/migrate-from-mariadb.ts` (ตรวจจำนวนแถวทุกตารางตรงกัน) — ไฟล์ dump เดิมอยู่ที่ `E:\Claude_Jobs\backups\`
ถ้าต้องย้ายข้อมูลจากเครื่องอื่นที่ยังใช้ MariaDB:
```powershell
cd express; npx prisma migrate deploy
$env:LEGACY_MARIADB_URL = 'mysql://it_app:รหัส@127.0.0.1:3307/it_system'; npm run db:import-mariadb   # เพิ่ม -- --truncate เพื่อแทนที่ข้อมูลเดิม
```
> **กลับไปใช้ Laravel เป็นหลัก**: `API_URL=http://127.0.0.1:8010/api/v1`, ตั้ง `SCHEDULER_ENABLED: "false"` ที่ service express
> แล้ว `docker compose --profile laravel-scheduler up -d` (อย่าเปิด scheduler ทั้งสองฝั่งพร้อมกัน — จะแจ้งเตือนซ้ำ)

## 2) Frontend (Next.js) — รันที่ `E:\Claude_Jobs\it-management\frontend`

```powershell
cd E:\Claude_Jobs\it-management\frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

(`.env.local` ชี้ `API_URL=http://127.0.0.1:8020/api/v1` (Express); ถ้าพอร์ต 3000 ถูกใช้ ให้รัน `npm run dev -- -p 3001`)

**บัญชีตัวอย่าง** (รหัสผ่าน = `SEED_ADMIN_PASSWORD` ใน `backend\.env`, ค่าเริ่มต้น `ChangeMe!2026`)

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
| GET / POST / PATCH / DELETE | `/kpi[/{id}]` | ทุกคน | บันทึก KPI ของตัวเอง (admin / หัวหน้า IT ดูของทุกคน: `user_id`, `from`, `to`) |
| GET | `/ui-config` | ทุกคน | การมองเห็นเมนู/ปุ่ม + ลำดับเมนู (แก้ผ่าน `PUT /settings` คีย์ `ui_permissions`, `menu_order` — admin) |
| GET / POST / DELETE | `/auth/me/signature` | ทุกคน | ลายเซ็นในโปรไฟล์ (multipart `signature`: PNG/JPG/WebP ≤ 1MB) — แสตมป์ลงช่องผู้แจ้งของใบแจ้งงาน |
| GET | `/tickets?scope=mine\|approvals\|it` | ทุกคน | ตาม scope ที่มีสิทธิ์ + `counts` |
| GET | `/tickets/form-options` | ทุกคน | สาขา, เจ้าหน้าที่ IT, ตัวเลือก "อื่นๆ" |
| POST | `/tickets` | ทุกคน | multipart: `photos[]` ≤ 4 (1MB), `documents[]` ≤ 5 (5MB) — ลายเซ็นผู้แจ้งคัดลอกจากโปรไฟล์ ณ ตอนแจ้ง (ส่ง `signature` data URL PNG มาแทนได้) |
| GET | `/tickets/{uuid}` | ผู้เกี่ยวข้อง | |
| POST | `/tickets/{uuid}/approve` \| `reject` | หัวหน้าตามสาย | reject ต้องมี `comment` |
| POST | `/tickets/{uuid}/accept` \| `result` | เจ้าหน้าที่ IT | result: multipart + `parts[]` |
| POST | `/tickets/{uuid}/close` \| `return` | หัวหน้า IT | |
| GET | `/tickets/{uuid}/files/{kind}/{id}` | ผู้เกี่ยวข้อง | ไฟล์ใน private disk |
| GET/POST/PATCH/DELETE | `/credentials[/{id}]` | IT, admin | ไม่ส่งรหัสผ่านใน response |
| POST | `/credentials/{id}/reveal` | IT, admin | บันทึก log (30 ครั้ง/นาที) |
| GET | `/credentials/{id}/logs` | IT, admin | |
| GET/POST/PATCH/DELETE | `/contracts[/{id}]` | IT, admin | `status=active\|expiring\|expired`, `search` |
| GET/POST/PATCH/DELETE | `/branches[/{id}]` | อ่าน: ทุกคน · แก้: admin | |
| GET / PUT | `/settings` | admin | |
| GET | `/notifications` · POST `/notifications/{id}/read` · `/notifications/read-all` | ทุกคน | |
| GET/POST/PATCH/DELETE | `/assets`, `/locations`, `/users`, `/movements` | ตามบทบาท | (ชุดเดิมของทะเบียนสินทรัพย์) |

## Security ที่ทำไว้

- **Token ไม่ถึง browser**: Next.js เรียก API จากฝั่ง server และเก็บ token ใน cookie `httpOnly` + `sameSite=lax` + `secure` (production)
- **ไฟล์แนบ** อยู่ใน private disk ชื่อไฟล์สุ่ม เปิดผ่าน proxy ที่ตรวจสิทธิ์รายใบงาน; ลายเซ็นตรวจรูปแบบ PNG และขนาด
- **รหัสผ่านในคลัง** เข้ารหัสด้วย `APP_KEY` — **สำรอง `APP_KEY` ไว้เสมอ** ถ้าหายจะถอดรหัสข้อมูลเดิมไม่ได้
- Policies/Gates ทุก endpoint, FormRequest validation, rate limiting, UUID ใน URL, soft delete, security headers, CORS จำกัด origin
- DB user `it_app` แยกสิทธิ์เฉพาะฐาน `it_system`
