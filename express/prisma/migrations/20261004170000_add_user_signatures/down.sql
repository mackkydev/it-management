-- ย้อนกลับ add_user_signatures (รันด้วย psql เอง) — ไฟล์ลายเซ็นใน storage ไม่ถูกลบ, users.signature_path ไม่ถูกแตะ
BEGIN;
DROP TABLE IF EXISTS "user_signatures";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261004170000_add_user_signatures';
COMMIT;
