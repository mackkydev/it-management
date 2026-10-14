-- ย้อนกลับ 20261027090000_two_factor (รันด้วย mysql client เอง) — ผู้ใช้ที่เปิด 2FA ไว้จะกลับไป login ด้วยรหัสผ่านอย่างเดียว
ALTER TABLE `users` DROP COLUMN `two_factor_confirmed_at`,
    DROP COLUMN `two_factor_last_step`,
    DROP COLUMN `two_factor_recovery_codes`,
    DROP COLUMN `two_factor_secret`;
DELETE FROM `app_settings` WHERE `key` = 'two_factor_required';
