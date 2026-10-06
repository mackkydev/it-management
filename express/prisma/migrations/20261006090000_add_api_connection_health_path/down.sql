-- ย้อนกลับ 20261006090000_add_api_connection_health_path (รันด้วย mysql client เอง)
ALTER TABLE `api_connections` DROP COLUMN `health_path`;
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261006090000_add_api_connection_health_path';
