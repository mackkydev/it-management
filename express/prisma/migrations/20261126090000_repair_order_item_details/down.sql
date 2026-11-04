-- ย้อนกลับ 20261126090000_repair_order_item_details (รันด้วยมือ แล้วลบแถวใน _prisma_migrations)
ALTER TABLE `repair_orders` DROP COLUMN `item_details`, DROP COLUMN `document_no`;
