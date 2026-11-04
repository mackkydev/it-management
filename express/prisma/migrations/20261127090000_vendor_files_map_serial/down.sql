-- ย้อนกลับ 20261127090000_vendor_files_map_serial (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ใน storage/private/vendors ต้องลบแยก
DROP TABLE `vendor_files`;
ALTER TABLE `repair_orders` DROP COLUMN `item_serial`;
ALTER TABLE `vendors` DROP COLUMN `map_url`;
