# IT-SYSTEM — คู่มือขึ้นระบบจริง (ด้านความปลอดภัย)

เอกสารนี้ครอบคลุมสิ่งที่ต้องทำ **ก่อนเปิดใช้งานออนไลน์** — ตามลำดับ ทำครบแล้วรัน `npm run security:check` ต้องไม่มี FAIL

## 1. ตรวจความพร้อมด้วยคำสั่ง

```bash
cd express && npm run security:check            # เครื่องพัฒนา (tsx)
docker compose exec express npm run security:check:prod   # ใน container บนเครื่องจริง
```

- FAIL = ต้องแก้ก่อนเปิดใช้ (exit code 1 — ใส่ใน script deploy ได้), WARN = ควรแก้หรือตรวจสอบ
- ตรวจ: บัญชีตัวอย่าง `@example.com`, บัญชีที่ยังใช้รหัสผ่านของ seed (`SEED_ADMIN_PASSWORD`), super_admin บัญชี LOCAL จริง,
  2FA ของผู้ดูแลระบบ, `NODE_ENV`, ผู้ใช้/รหัสผ่านฐานข้อมูล, อายุ session, `BCRYPT_ROUNDS`, การป้องกันตอนเปิดดูข้อมูลลับ

## 2. บัญชีผู้ใช้

1. สร้างบัญชี **super_admin บัญชี LOCAL จริง** (อีเมลจริง รหัสผ่านยาว) ที่หน้า ผู้ใช้งาน → เพิ่มผู้ใช้
2. login ด้วยบัญชีใหม่ แล้วเปิด **ยืนยันตัวตน 2 ขั้น** ที่หน้า ข้อมูลส่วนตัว (ต้องมีแอป Google / Microsoft Authenticator)
3. **ปิดใช้งานบัญชีตัวอย่าง** (`admin@example.com`, `it.head@example.com`, `it.staff@example.com`, `*.sales.*`, `*.acc.*` ฯลฯ)
   หรือเปลี่ยนเป็นอีเมล/รหัสผ่านจริงถ้าจะใช้ต่อ — บัญชีเหล่านี้ใช้รหัสผ่านเดียวกันทั้งหมด
4. เปิด **บังคับ 2FA ผู้ดูแลระบบ** ที่หน้า ตั้งค่าระบบ (เฉพาะผู้ดูแลระบบสูงสุด) — ผู้ดูแลระบบที่ยังไม่ตั้งจะถูกให้ตั้งตอน login ครั้งถัดไป
   - โทรศัพท์หาย: ผู้ดูแลระบบสูงสุดกด "รีเซ็ต 2FA" ที่หน้าแก้ไขผู้ใช้ (ผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์) หรือผู้ใช้ใช้ **รหัสสำรอง** ที่ได้ตอนเปิดใช้
5. หน้า ตั้งค่าระบบ → การเปิดดูข้อมูลลับ: เปิด "ยืนยันตัวตนซ้ำ" และ **จำกัด IP** เฉพาะ IP สำนักงาน / VPN

## 3. ค่าในไฟล์ `.env` (ไม่ขึ้น git — ย้ายมาจากเครื่องเดิม)

| ไฟล์ | ค่า | หมายเหตุ |
|---|---|---|
| `.env` (โฟลเดอร์หลัก) | `IT_DB_PASSWORD`, `IT_DB_ROOT_PASSWORD` | สุ่มยาว ≥ 24 ตัว (`openssl rand -base64 32`) — ไม่ตั้ง = ได้ค่าตั้งต้น `change_me…` ที่ใครก็รู้ |
| `express/.env` | `APP_KEY` | **ต้องเป็นค่าเดิม** — ข้อมูลที่เข้ารหัสไว้ (รหัสผ่านคลัง, license key, ลายเซ็น, 2FA) ใช้คีย์นี้ |
| `express/.env` | `DB_PASSWORD` | = `IT_DB_PASSWORD` |
| `express/.env` | `NODE_ENV=production`, `TRUST_PROXY` ใช้ค่าตั้งต้น | หน้าเว็บ (container `it_frontend`) เรียก API ผ่าน docker network (IP 172.x = uniquelocal) — อย่าแก้เป็น `loopback` |
| `express/.env` | `SEED_ADMIN_PASSWORD` | ลบออกหลัง seed ครั้งแรก (ใช้แค่ตอนสร้างบัญชีตัวอย่าง / ตอนรัน security:check) |

## 4. เครือข่าย / reverse proxy

```
ผู้ใช้ ──https──▶ Caddy (443) ──▶ it_frontend 127.0.0.1:3000 ──(docker network)──▶ it_express :8020 ──▶ it_mysql
```

- เปิดสู่ภายนอก **เฉพาะ 80/443 ของ Caddy** — MySQL (3308), API (8020), phpMyAdmin (8082), Adminer (8081) bind `127.0.0.1` อยู่แล้ว ห้ามแก้เป็น `0.0.0.0`
- เครื่องจริงรันเฉพาะ 3 service: `docker compose --profile web up -d --build mysql express frontend`
  ไม่ต้องรัน phpMyAdmin / Adminer (ใช้ผ่าน SSH tunnel เมื่อจำเป็น)
- หน้าเว็บ = image จาก [`frontend/Dockerfile`](../frontend/Dockerfile) (Next.js standalone, รันด้วยผู้ใช้ `node` ไม่ใช่ root, healthcheck)
  ค่าเดียวที่ต้องมีคือ `API_URL` (ตั้งใน docker-compose.yml แล้ว) — เปลี่ยนพอร์ตบนเครื่องด้วย `IT_WEB_PORT` ใน `.env` โฟลเดอร์หลัก
- ตัวอย่าง Caddy อยู่ที่ [`deploy/Caddyfile`](Caddyfile) — **ต้องเขียนทับ `X-Real-IP` / `X-Forwarded-For`** ด้วย IP จริง
  ไม่งั้นผู้ใช้ปลอม IP ได้ (หน้าเว็บส่ง IP นี้ต่อให้ API ใช้กับการจำกัด IP ตอนเปิดดูข้อมูลลับ, rate limit การ login และ audit log)
- ผ่าน **Cloudflare Tunnel**: ใช้บล็อกท้ายไฟล์ Caddyfile (cloudflared → Caddy → Next.js) — IP จริงมาจาก `CF-Connecting-IP`
- ใช้ภายในบริษัทอย่างเดียว: ปลอดภัยที่สุดคือไม่เปิดสู่อินเทอร์เน็ตตรงๆ — เข้าผ่าน VPN หรือ Cloudflare Access

### header ความปลอดภัย (มีในแอปแล้ว)

- **CSP** แบบ nonce ต่อ request — `frontend/src/proxy.ts` (script ได้เฉพาะของเราเอง, ห้ามฝังหน้าในเว็บอื่น)
- **HSTS** (1 ปี) ทั้งหน้าเว็บ (`frontend/next.config.ts`, production เท่านั้น) และ API (เมื่อเรียกผ่าน https)
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`
- cookie session: `httpOnly` + `SameSite=Lax` + `Secure` (เมื่อไม่ใช่ localhost), หมดอายุ 12 ชม.

## 5. สำรองข้อมูล (เข้ารหัส)

สคริปต์ [`deploy/backup.sh`](backup.sh): dump ฐานข้อมูล + `storage/private` + ไฟล์ `.env` → tar → เข้ารหัส **AES-256 (openssl, PBKDF2)** ในท่อเดียว
(ไม่เขียนไฟล์ dump ดิบลงดิสก์) แล้วลบไฟล์ที่เก่ากว่า `KEEP_DAYS` วัน — ส่งสำเนาออกนอกเครื่องด้วย rclone ได้

```bash
cp deploy/backup.env.example deploy/backup.env && chmod 600 deploy/backup.env   # แก้ค่า
openssl rand -base64 48 | sudo tee /root/.it-system-backup-pass >/dev/null && sudo chmod 600 /root/.it-system-backup-pass
sudo bash deploy/backup.sh                                                       # ทดสอบ
# crontab -e (ทุกวัน 02:30)
30 2 * * * /usr/bin/bash /opt/it-management/deploy/backup.sh >> /var/log/it-system-backup.log 2>&1
```

**เก็บสำเนาไฟล์รหัสผ่าน `/root/.it-system-backup-pass` ไว้นอกเครื่อง** (ตู้เซฟ / password manager ของบริษัท) — หายแล้วถอดไฟล์สำรองไม่ได้

### กู้คืนข้อมูล

```bash
sha256sum -c it-system-YYYYmmdd-HHMM.tar.gz.enc.sha256
mkdir restore && openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/.it-system-backup-pass \
  -in it-system-YYYYmmdd-HHMM.tar.gz.enc | tar -xzf - -C restore
# restore/express/.env, restore/.env  → วางกลับที่เดิม (APP_KEY ต้องตรง)
# restore/storage/private              → คัดลอกกลับไปที่ storage/private
gunzip -c restore/it_system.sql.gz | docker exec -i it_mysql sh -c 'exec mysql -uroot -p"$MYSQL_ROOT_PASSWORD" it_system'
docker compose up -d --build express
rm -rf restore                                        # ไฟล์ที่ถอดแล้วมีข้อมูลลับ — ลบทิ้งหลังกู้คืน
```

ทดสอบกู้คืนกับเครื่องสำรองอย่างน้อยเดือนละครั้ง — ไฟล์สำรองที่ไม่เคยลองกู้คืน = ไม่แน่ใจว่าใช้ได้

## 6. อัปเดตเวอร์ชัน

```bash
git pull
docker exec it_mysql sh -c 'mysqldump …' > ก่อนอัปเดต.sql   # หรือ bash deploy/backup.sh
docker compose run --rm express npx prisma migrate deploy   # migration ใหม่ (สำรองฐานก่อนเสมอ)
docker compose --profile web up -d --build express frontend
docker compose exec express npm run security:check:prod     # ต้องไม่มี FAIL
(cd express && npm audit --omit=dev) && (cd frontend && npm audit --omit=dev)   # ต้องไม่มี high / critical
```
