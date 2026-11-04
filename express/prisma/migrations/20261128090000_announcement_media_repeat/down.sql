-- ย้อนกลับ 20261128090000_announcement_media_repeat (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ใน storage/private/announcements ต้องลบแยก
DROP TABLE `announcement_files`;
ALTER TABLE `announcements` DROP COLUMN `repeat_mode`, DROP COLUMN `repeat_weekday`, DROP COLUMN `repeat_day`, DROP COLUMN `repeat_month`;
