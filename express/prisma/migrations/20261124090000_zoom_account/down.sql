-- ย้อนกลับ 20261124090000_zoom_account (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
DELETE FROM `dropdown_options` WHERE `list` = 'zoom_account';
ALTER TABLE `zoom_bookings` DROP COLUMN `zoom_account`;
