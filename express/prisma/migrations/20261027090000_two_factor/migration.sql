-- 2FA (TOTP) ของผู้ใช้ LOCAL — เพิ่มอย่างเดียว (additive); การบังคับใช้กับผู้ดูแลระบบ = app_settings.two_factor_required
ALTER TABLE `users` ADD COLUMN `two_factor_confirmed_at` DATETIME(0) NULL,
    ADD COLUMN `two_factor_last_step` BIGINT NULL,
    ADD COLUMN `two_factor_recovery_codes` TEXT NULL,
    ADD COLUMN `two_factor_secret` TEXT NULL;
