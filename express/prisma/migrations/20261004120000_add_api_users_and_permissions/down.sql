-- ย้อนกลับ migration add_api_users_and_permissions (Prisma ไม่รัน down เอง — รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
--   psql ... -f prisma/migrations/20261004120000_add_api_users_and_permissions/down.sql
-- ถ้ามี API User อยู่แล้ว จะหยุดทันที (ต้องตัดสินใจเองว่าจะลบหรือแปลงผู้ใช้เหล่านั้นก่อน — ไม่ลบให้อัตโนมัติ)
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "type" <> 'LOCAL' OR "email" IS NULL OR "password" IS NULL) THEN
    RAISE EXCEPTION 'rollback stopped: API users (or users without email/password) exist';
  END IF;
END $$;

DROP TABLE IF EXISTS "external_sessions";
DROP TABLE IF EXISTS "user_permissions";
DROP TABLE IF EXISTS "role_permissions";
DROP TABLE IF EXISTS "permissions";
DROP TABLE IF EXISTS "audit_logs";

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_type_check";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_local_credentials_check";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_api_identity_check";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_connection_id_foreign";
DROP INDEX IF EXISTS "users_connection_id_external_id_unique";
DROP INDEX IF EXISTS "users_type_index";
ALTER TABLE "users" DROP COLUMN IF EXISTS "connection_id",
  DROP COLUMN IF EXISTS "external_id",
  DROP COLUMN IF EXISTS "external_synced_at",
  DROP COLUMN IF EXISTS "type",
  ALTER COLUMN "email" SET NOT NULL,
  ALTER COLUMN "password" SET NOT NULL;

DROP TABLE IF EXISTS "api_connections";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261004120000_add_api_users_and_permissions';

COMMIT;
