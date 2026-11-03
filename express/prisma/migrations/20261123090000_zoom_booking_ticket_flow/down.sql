-- ย้อนกลับ 20261123090000_zoom_booking_ticket_flow (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
-- สถานะ needs_change ที่ค้างอยู่กลับเป็น rejected ตามเดิม, ใบงาน source = 'zoom' ที่ยังเปิดอยู่ถูกยกเลิก (โค้ดเดิมไม่รู้จัก)
UPDATE `zoom_bookings` SET `status` = 'rejected' WHERE `status` = 'needs_change';
UPDATE `it_tickets` SET `status` = 'cancelled', `cancelled_at` = UTC_TIMESTAMP(), `closed_at` = UTC_TIMESTAMP() WHERE `source` = 'zoom' AND `status` IN ('approved', 'in_progress', 'pending_it_head');
ALTER TABLE `zoom_bookings` DROP FOREIGN KEY `zoom_bookings_meeting_booking_id_foreign`, DROP INDEX `zoom_bookings_meeting_booking_id_index`, DROP COLUMN `meeting_booking_id`;
ALTER TABLE `it_tickets` DROP COLUMN `source`;
