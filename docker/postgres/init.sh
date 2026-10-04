#!/bin/sh
# รันครั้งแรกที่สร้าง volume ของ PostgreSQL เท่านั้น (docker-entrypoint-initdb.d)
# - it_app = ผู้ใช้ของแอป (ไม่ใช่ superuser) เป็นเจ้าของฐาน it_system, it_system_test (เทสต์), it_system_shadow (prisma migrate dev)
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
  CREATE ROLE it_app LOGIN PASSWORD '${IT_DB_PASSWORD}';
  CREATE DATABASE it_system OWNER it_app;
  CREATE DATABASE it_system_test OWNER it_app;
  CREATE DATABASE it_system_shadow OWNER it_app;
EOSQL

# schema public ต้องเป็นของ it_app (PostgreSQL 15+ ไม่ให้ผู้ใช้ทั่วไปสร้างตารางใน public)
for db in it_system it_system_test it_system_shadow; do
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" -c "ALTER SCHEMA public OWNER TO it_app;"
done
