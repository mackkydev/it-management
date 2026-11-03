-- จอง ZOOM: ใบแจ้งงานเกิดตั้งแต่ตอนจอง (it_tickets.source = 'zoom' — จัดการที่หน้า ZOOM) + จองพร้อมห้องประชุม
ALTER TABLE `it_tickets` ADD COLUMN `source` VARCHAR(20) NULL;

ALTER TABLE `zoom_bookings` ADD COLUMN `meeting_booking_id` BIGINT NULL,
  ADD INDEX `zoom_bookings_meeting_booking_id_index` (`meeting_booking_id`),
  ADD CONSTRAINT `zoom_bookings_meeting_booking_id_foreign` FOREIGN KEY (`meeting_booking_id`) REFERENCES `meeting_bookings` (`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
