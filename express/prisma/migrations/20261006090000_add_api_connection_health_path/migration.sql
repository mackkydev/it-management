-- ปุ่มตรวจการเข้าถึงต้นทาง (เช่น /health ของ STEC SyteLine API) — เพิ่มคอลัมน์อย่างเดียว
-- AlterTable
ALTER TABLE `api_connections` ADD COLUMN `health_path` VARCHAR(255) NULL;

