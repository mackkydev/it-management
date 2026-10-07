-- ย้อนกลับ 20261009090000_user_secret_pin (รันด้วย mysql client เอง)
ALTER TABLE `users` DROP COLUMN `secret_pin_failures`, DROP COLUMN `secret_pin_locked_until`;
