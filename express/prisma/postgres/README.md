# PostgreSQL 18 — ฐานข้อมูลทางเลือก (`DB_CLIENT=postgres`)

ระบบใช้ **MySQL 8.4 เป็นค่าตั้งต้น** — PostgreSQL 18 เป็นทางเลือกสำหรับเปรียบเทียบ/ย้ายในอนาคต เลือกด้วยตัวแปร `DB_CLIENT` ของ API

| | MySQL (ค่าตั้งต้น) | PostgreSQL 18 |
|---|---|---|
| ตั้งค่า | `DB_CLIENT=mysql` (หรือไม่ตั้ง) | `DB_CLIENT=postgres` |
| schema | `prisma/schema.prisma` (ต้นฉบับ) | `prisma/postgres/schema.prisma` (สร้างจากต้นฉบับ) |
| migration | `prisma/migrations` | `prisma/postgres/migrations` |
| docker | `mysql` / `it_mysql` :3308 | `pgsql` / `it_pgsql` :5434 (profile `postgres`) |
| driver | mysql2 | pg (`src/db-postgres.ts`) |

## เปิดใช้บนเครื่อง (Docker)

```sh
docker compose --profile postgres up -d pgsql          # PostgreSQL 18 (volume it_pgsql แยกจากฐานเดิม)
cd express
DB_CLIENT=postgres DB_PORT=5434 npx prisma migrate deploy
DB_CLIENT=postgres DB_PORT=5434 npm run db:seed        # หรือคัดลอกข้อมูลจริงจาก MySQL (ด้านล่าง)
```

ให้ container `it_express` ใช้ PostgreSQL: ใส่ใน `.env` ข้าง `docker-compose.yml` แล้ว `docker compose --profile postgres up -d`

```
IT_DB_CLIENT=postgres
IT_DB_HOST=pgsql
IT_DB_PORT=5432
```

รัน `npm run dev` บนเครื่อง: ตั้ง `DB_CLIENT=postgres`, `DB_PORT=5434` ใน `express/.env` (ผู้ใช้/รหัสผ่าน `it_app` เหมือน MySQL)

## คัดลอกข้อมูลจริงจาก MySQL มาเปรียบเทียบ

```sh
DB_CLIENT=postgres DB_PORT=5434 SOURCE_MYSQL_URL=mysql://it_app:รหัส@127.0.0.1:3308/it_system npm run db:copy-to-postgres
```

อ่าน MySQL อย่างเดียว, ปลายทางต้องว่าง (`-- --truncate` = ล้างก่อน) — ไฟล์แนบใน `storage/private` ใช้ร่วมกันได้เลย

## เทสต์

```sh
DB_CLIENT=postgres DB_PORT=5434 npm test   # สร้างฐาน it_system_test ใหม่จาก migration ชุดนี้ทุกครั้ง
```

## เพิ่ม/แก้ตาราง (ต้องทำทั้งสองฐาน)

1. แก้ `prisma/schema.prisma` แล้วสร้าง migration ของ MySQL ตามเดิม (`npm run db:migrate -- --name <ชื่อ>`)
2. `npm run db:pg:schema` — สร้าง `prisma/postgres/schema.prisma` ใหม่จากต้นฉบับ (ห้ามแก้ไฟล์นี้ตรงๆ)
3. `DB_CLIENT=postgres DB_PORT=5434 npm run db:migrate -- --name <ชื่อเดียวกัน>` — migration ชุด PostgreSQL
4. SQL ที่เขียนเองใน migration MySQL (CHECK, GENERATED, ข้อมูล) ต้องเขียนแบบ PostgreSQL ใส่ migration ชุดนี้ด้วย
5. รันเทสต์ทั้งสองฐาน

## SQL ในโค้ด

เขียน SQL แบบ MySQL ชุดเดียวตามกฎใน CLAUDE.md — `translatePg()` ใน `src/db-postgres.ts` แปลงให้ตอนส่ง query:

- `INSERT IGNORE` → `ON CONFLICT DO NOTHING`, `AS new ON DUPLICATE KEY UPDATE` → `ON CONFLICT (unique key) DO UPDATE` (ใช้ unique key ที่ไม่ใช่ PK ก่อน)
- `JSON_UNQUOTE(JSON_EXTRACT(x, '$.k'))` / `x->>'$.k'` → `x::jsonb->>'k'`, `JSON_CONTAINS(x, ?)` → `@>`
- `DATE_ADD/DATE_SUB(…, INTERVAL n DAY)`, `UTC_TIMESTAMP()`, `CAST(… AS CHAR/UNSIGNED/DATETIME)`, `GROUP_CONCAT`, `SUBSTRING_INDEX`, `` `ชื่อ` ``, ข้อความที่มี `\`
- ฟังก์ชันใน migration `1_mysql_compat`: `<=>`, `FIELD()`, `CONVERT_TZ()` (offset ±HH:MM), `YEAR()`, `CURDATE()`, citext `=` ตัวเลข
- `JSON_TABLE` / `JSON_ARRAYAGG` เป็นมาตรฐาน SQL ใช้ได้ทั้งสองฐาน (PostgreSQL 17+)

**ที่แปลงให้ไม่ได้ — เขียนให้ใช้ได้ทั้งสองฐาน:**

- `UPDATE … JOIN`, `DELETE a FROM a JOIN …`, `UPDATE … ORDER BY … LIMIT` → ใช้ subquery (`WHERE id IN (SELECT … FROM (…) AS x)`)
- `UPDATE t SET t.col = …` → `SET col = …` (PostgreSQL ไม่ให้ใส่ alias หน้าคอลัมน์ที่ SET)
- `IF(a, b, c)` → `CASE WHEN a THEN b ELSE c END`, `SUM(เงื่อนไข)` → `SUM(CASE WHEN … THEN 1 ELSE 0 END)`
- `UPDATE IGNORE` → แยกตาม `isPostgres` (ดู `renameIgnoringDuplicates` ใน routes/dropdown-options.ts)
- นิพจน์ boolean ใน SELECT: MySQL คืน 1/0 แต่ PostgreSQL คืน true/false — ใช้แบบ truthy หรือ `Number(…)` ห้าม `=== 1`
- คอลัมน์ boolean เทียบกับ `true`/`false` ห้ามเทียบกับ 1/0
- NULL ตอนเรียง: MySQL ไว้หน้าสุด (ASC) แต่ PostgreSQL ไว้ท้ายสุด — ถ้าลำดับสำคัญ ใช้ `CASE WHEN … IS NULL THEN …` ใน ORDER BY
- `CONCAT()` ที่มีค่า NULL: MySQL ได้ NULL / PostgreSQL ข้าม NULL

## ความต่างที่ตั้งใจคงไว้

- ข้อความทุกคอลัมน์เป็น `citext` (ไม่สนตัวพิมพ์ แยกวรรณยุกต์ เหมือน `utf8mb4_0900_as_ci`) — ไม่จำกัดความยาวที่ฐาน (API ตรวจความยาวอยู่แล้ว)
- เรียงข้อความไทยตาม locale `C.UTF-8` (ลำดับรหัสอักษร) ไม่ใช่ UCA ของ MySQL
- JSON เก็บเป็น `jsonb` — ลำดับ key ใน object อาจเปลี่ยน (MySQL ก็เรียง key ใหม่เช่นกัน)
