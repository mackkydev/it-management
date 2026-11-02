-- ย้อนกลับ 20261111090000_ticket_attachment_event (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ยังอยู่ แต่ไม่ผูกกับรายการประวัติ
ALTER TABLE `it_ticket_attachments` DROP FOREIGN KEY `it_ticket_attachments_event_id_foreign`;
DROP INDEX `it_ticket_attachments_event_id_index` ON `it_ticket_attachments`;
ALTER TABLE `it_ticket_attachments` DROP COLUMN `event_id`;
