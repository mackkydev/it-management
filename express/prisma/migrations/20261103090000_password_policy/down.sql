-- ย้อนกลับ 20261103090000_password_policy (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
ALTER TABLE `users` DROP COLUMN `login_failures`,
    DROP COLUMN `login_locked_until`,
    DROP COLUMN `password_changed_at`;
DELETE FROM `app_settings` WHERE `key` = 'password_policy';
