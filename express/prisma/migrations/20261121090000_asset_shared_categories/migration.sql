-- ผู้ถือครองส่วนกลาง: ถือครองโดยสาขา/แผนก ไม่ผูกผู้ใช้
ALTER TABLE `assets` ADD COLUMN `is_shared` BOOLEAN NOT NULL DEFAULT false;

-- หมวดหมู่สินทรัพย์แก้ได้ที่ ข้อมูล Drop Down (คอมพิวเตอร์ / Software เป็นรหัสตายตัว ไม่อยู่ในรายการนี้) — เฟอร์นิเจอร์ เปลี่ยนเป็น ปริ้นเตอร์
INSERT INTO `dropdown_options` (`list`, `name`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('asset_category', 'อุปกรณ์ IT', true, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('asset_category', 'ปริ้นเตอร์', true, 2, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('asset_category', 'ยานพาหนะ', true, 3, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('asset_category', 'เครื่องมือ/อุปกรณ์', true, 4, UTC_TIMESTAMP(), UTC_TIMESTAMP());
