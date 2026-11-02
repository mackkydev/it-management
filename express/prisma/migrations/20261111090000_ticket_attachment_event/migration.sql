-- ไฟล์แนบที่ผูกกับเหตุการณ์ในประวัติใบงาน (อัปเดตความคืบหน้า / บันทึกผล) — กดดูไฟล์ได้จากรายการประวัติ; NULL = ไฟล์ตอนแจ้งงาน/ข้อมูลเดิม
ALTER TABLE `it_ticket_attachments` ADD COLUMN `event_id` BIGINT NULL;
CREATE INDEX `it_ticket_attachments_event_id_index` ON `it_ticket_attachments`(`event_id`);
ALTER TABLE `it_ticket_attachments` ADD CONSTRAINT `it_ticket_attachments_event_id_foreign` FOREIGN KEY (`event_id`) REFERENCES `it_ticket_events`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
