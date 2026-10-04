-- ย้อนกลับ add_username_and_directory_sync (รันด้วย psql เอง) — username / สถานะซิงค์ที่บันทึกไว้จะหายไป
BEGIN;
DROP INDEX IF EXISTS "users_username_lower_unique";
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_username_check", DROP CONSTRAINT IF EXISTS "users_external_status_check";
ALTER TABLE "users" DROP COLUMN IF EXISTS "username", DROP COLUMN IF EXISTS "external_status";
ALTER TABLE "api_connections" DROP COLUMN IF EXISTS "active_values", DROP COLUMN IF EXISTS "last_sync_result", DROP COLUMN IF EXISTS "last_synced_at",
  DROP COLUMN IF EXISTS "sync_interval_minutes", DROP COLUMN IF EXISTS "users_list_path", DROP COLUMN IF EXISTS "users_list_root_path",
  DROP COLUMN IF EXISTS "users_page_param", DROP COLUMN IF EXISTS "users_page_size", DROP COLUMN IF EXISTS "users_page_size_param";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261005120000_add_username_and_directory_sync';
COMMIT;
