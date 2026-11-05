-- ย้อนกลับ 20261201090000_user_login_tracking (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
ALTER TABLE `users`
    DROP COLUMN `last_login_at`,
    DROP COLUMN `last_login_failed_at`,
    DROP COLUMN `last_locked_at`,
    DROP COLUMN `last_lock_reason`,
    DROP COLUMN `last_lock_attempts`,
    DROP COLUMN `inactive_unlocked_at`,
    DROP COLUMN `password_change_forced`;
