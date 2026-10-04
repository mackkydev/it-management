-- ย้อนกลับ add_departments_divisions (รันด้วย psql เอง) — users.department / division ไม่ถูกแตะ
BEGIN;
DROP TABLE IF EXISTS "departments";
DROP TABLE IF EXISTS "divisions";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261004150000_add_departments_divisions';
COMMIT;
