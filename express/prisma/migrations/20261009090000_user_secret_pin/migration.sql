-- PIN กลางสำหรับเปิดดูรหัสผ่านในคลังบัญชี / License key (ค่า PIN เก็บเป็น bcrypt ใน app_settings.secret_pin)
-- ตัวนับรายคน: กรอก PIN ผิดติดกัน 5 ครั้ง = ล็อกคนนั้น 15 นาที (secret_pin_locked_until)
ALTER TABLE `users`
  ADD COLUMN `secret_pin_failures` SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN `secret_pin_locked_until` DATETIME(0) NULL;
