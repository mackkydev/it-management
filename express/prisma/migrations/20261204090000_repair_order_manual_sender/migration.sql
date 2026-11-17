-- ส่งเคลม/แจ้งซ่อม: อุปกรณ์ที่ไม่อยู่ในระบบ (ไม่ผูกสินทรัพย์/ใบแจ้งงาน — ใช้ item_name + item_details เดิม)
-- ผู้ส่งซ่อม (เจ้าของอุปกรณ์) = ข้อความพิมพ์เอง sender_name; เลือกจากผู้ใช้ในระบบ = sent_by_id ด้วย (ไม่บังคับแล้ว)
-- ผู้บันทึกงานซ่อม = created_by (มีอยู่แล้ว)
ALTER TABLE `repair_orders` ADD COLUMN `sender_name` VARCHAR(255) COLLATE utf8mb4_0900_as_ci NULL;
ALTER TABLE `repair_orders` MODIFY `sent_by_id` BIGINT NULL;
