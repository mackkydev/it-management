-- ย้อนกลับ 20261120090000_user_job_title (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ตำแหน่งงานที่กรอกไว้หายไป
ALTER TABLE `users` DROP COLUMN `job_title`;
