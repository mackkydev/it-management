-- จองรถ: เพิ่มประเภทการใช้งาน (ข้อมูล Drop Down list vehicle_purpose) — ชื่อซ้ำที่มีอยู่แล้ว = ข้าม (INSERT IGNORE)
INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('vehicle_purpose', 'ใช้ชั่วคราว', 3, NOW(), NOW()),
  ('vehicle_purpose', 'ใช้ระหว่างรอรถซ่อม', 4, NOW(), NOW());
