-- สำหรับติดตั้ง PostgreSQL เองโดยไม่ใช้ Docker (ใน Docker ใช้ docker/postgres/init.sh แทน)
-- รันด้วย superuser:  psql -U postgres -f database/create-database.sql
-- แล้วสร้างตาราง: cd express && npx prisma migrate deploy && npx prisma db seed

-- บัญชีของแอป (ไม่ใช่ superuser) — เปลี่ยนรหัสผ่านให้ตรงกับ DB_PASSWORD ใน express/.env
CREATE ROLE it_app LOGIN PASSWORD 'change_me_strong_password';

-- ICU collation 'und' = เรียงลำดับตามมาตรฐาน Unicode (รองรับภาษาไทย)
CREATE DATABASE it_system OWNER it_app TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' LOCALE 'C.UTF-8';
-- เฉพาะเครื่องพัฒนา: ฐานเทสต์ และฐานชั่วคราวของ prisma migrate dev
CREATE DATABASE it_system_test OWNER it_app TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' LOCALE 'C.UTF-8';
CREATE DATABASE it_system_shadow OWNER it_app TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und' LOCALE 'C.UTF-8';

-- PostgreSQL 15+: schema public ต้องเป็นของ it_app จึงสร้างตารางได้
\c it_system
ALTER SCHEMA public OWNER TO it_app;
\c it_system_test
ALTER SCHEMA public OWNER TO it_app;
\c it_system_shadow
ALTER SCHEMA public OWNER TO it_app;
