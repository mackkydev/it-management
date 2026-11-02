-- ย้อนกลับ 20261113090000_zoom_meeting_details (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
ALTER TABLE `zoom_bookings` DROP COLUMN `meeting_topic`, DROP COLUMN `meeting_id`, DROP COLUMN `passcode`;
