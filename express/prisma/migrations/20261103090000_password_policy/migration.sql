-- นโยบายรหัสผ่าน: ล็อกบัญชีเมื่อ login ผิดติดกัน + วันที่เปลี่ยนรหัสผ่านล่าสุด (บังคับเปลี่ยนทุก N วัน) — ผู้ใช้เดิม password_changed_at = NULL (นับจากวันที่เปิดนโยบาย)

-- AlterTable
ALTER TABLE `users` ADD COLUMN `login_failures` SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN `login_locked_until` DATETIME(0) NULL,
    ADD COLUMN `password_changed_at` DATETIME(0) NULL;
