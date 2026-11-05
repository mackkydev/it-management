-- ติดตามการเข้าสู่ระบบของผู้ใช้: เข้าล่าสุด / ผิดล่าสุด / ล็อกล่าสุด + ล็อกเมื่อไม่เข้าระบบ + บังคับตั้งรหัสผ่านใหม่จากการติ๊กของผู้ดูแล
ALTER TABLE `users`
    ADD COLUMN `last_login_at` DATETIME(0) NULL,
    ADD COLUMN `last_login_failed_at` DATETIME(0) NULL,
    ADD COLUMN `last_locked_at` DATETIME(0) NULL,
    ADD COLUMN `last_lock_reason` VARCHAR(20) NULL,
    ADD COLUMN `last_lock_attempts` INTEGER NULL,
    ADD COLUMN `inactive_unlocked_at` DATETIME(0) NULL,
    ADD COLUMN `password_change_forced` BOOLEAN NOT NULL DEFAULT false;
