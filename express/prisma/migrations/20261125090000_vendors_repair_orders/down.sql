-- ย้อนกลับ 20261125090000_vendors_repair_orders (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ใน storage/private/repair-orders ต้องลบแยก
ALTER TABLE `it_ticket_events` DROP FOREIGN KEY `it_ticket_events_repair_order_id_foreign`;
ALTER TABLE `it_ticket_events` DROP INDEX `it_ticket_events_repair_order_id_index`, DROP COLUMN `repair_order_id`;
DROP TABLE `repair_order_files`;
DROP TABLE `repair_orders`;
DROP TABLE `vendors`;
DELETE FROM `dropdown_options` WHERE `list` = 'vendor_type';
