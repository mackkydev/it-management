-- ย้อนกลับ 20261106090000_meeting_booking_end_date (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — การจองหลายวันเหลือเฉพาะวันแรก
DROP INDEX `meeting_bookings_room_id_end_date_index` ON `meeting_bookings`;
ALTER TABLE `meeting_bookings` DROP COLUMN `end_date`;
