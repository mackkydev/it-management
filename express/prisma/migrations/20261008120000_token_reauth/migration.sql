-- ยืนยันตัวตนซ้ำก่อนเปิดดูรหัสผ่าน / License key: เวลาที่ยืนยันรหัสผ่านล่าสุดของ token (session) นั้น
ALTER TABLE `personal_access_tokens` ADD COLUMN `reauth_at` DATETIME(0) NULL;
