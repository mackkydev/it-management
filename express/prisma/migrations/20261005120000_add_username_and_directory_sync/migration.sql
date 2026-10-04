-- AlterTable
ALTER TABLE "api_connections" ADD COLUMN     "active_values" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "last_sync_result" JSONB,
ADD COLUMN     "last_synced_at" TIMESTAMP(0),
ADD COLUMN     "sync_interval_minutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "users_list_path" VARCHAR(255),
ADD COLUMN     "users_list_root_path" VARCHAR(255),
ADD COLUMN     "users_page_param" VARCHAR(50),
ADD COLUMN     "users_page_size" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "users_page_size_param" VARCHAR(50);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "external_status" VARCHAR(20),
ADD COLUMN     "username" VARCHAR(50);


-- username ห้ามซ้ำแบบไม่สนตัวพิมพ์ และห้ามมี @ (กันสับสนกับอีเมลตอน login)
CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" (LOWER("username")) WHERE "username" IS NOT NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_username_check" CHECK ("username" IS NULL OR "username" !~ '@');
ALTER TABLE "users" ADD CONSTRAINT "users_external_status_check" CHECK ("external_status" IS NULL OR "external_status" IN ('active', 'disabled', 'missing'));
