-- ย้อนกลับ 20261107090000_must_change_password (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
ALTER TABLE `users` DROP COLUMN `must_change_password`;
