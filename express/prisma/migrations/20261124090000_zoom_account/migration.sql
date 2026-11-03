-- จอง ZOOM: บัญชี ZOOM ที่ฝ่าย IT ใช้ (ข้อมูล Drop Down list zoom_account — เก็บเป็นข้อความ เปลี่ยนชื่อ = อัปเดตข้อมูลเดิมตาม)
ALTER TABLE `zoom_bookings` ADD COLUMN `zoom_account` VARCHAR(100) NULL;

INSERT INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('zoom_account', 'bkk', 1, NOW(), NOW()),
  ('zoom_account', 'Zoom01', 2, NOW(), NOW());
