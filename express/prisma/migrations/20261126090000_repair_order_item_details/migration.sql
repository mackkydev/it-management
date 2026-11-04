-- รายการส่งซ่อม: รายละเอียดอุปกรณ์เพิ่มเติม + เลขที่เอกสาร (ไม่บังคับทั้งคู่)
ALTER TABLE `repair_orders` ADD COLUMN `item_details` TEXT NULL, ADD COLUMN `document_no` VARCHAR(100) NULL;
