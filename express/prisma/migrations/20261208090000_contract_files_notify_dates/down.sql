-- ย้อนกลับ 20261208090000_contract_files_notify_dates (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ใน storage/private/contracts ต้องลบแยก
DROP TABLE `contract_files`;
ALTER TABLE `contracts` DROP COLUMN `notified_for_date`;
ALTER TABLE `contracts` DROP COLUMN `notify_dates`;
