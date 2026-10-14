-- ค่าตั้งต้นของหมวดหมู่ (เพิ่มเฉพาะที่ยังไม่มี — ไม่แตะรายการเดิม)
-- หมวดหมู่สัญญา = ชื่อเดียวกับหมวดตั้งต้นของคลังบัญชี + คอมพิวเตอร์ / Hosting / Hostname ("อื่นๆ" อยู่ท้ายสุด)
INSERT IGNORE INTO `contract_categories` (`name`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('ระบบงาน', true, 1, NOW(), NOW()),
  ('เซิร์ฟเวอร์', true, 2, NOW(), NOW()),
  ('เครือข่าย', true, 3, NOW(), NOW()),
  ('อีเมล', true, 4, NOW(), NOW()),
  ('ซอฟต์แวร์/License', true, 5, NOW(), NOW()),
  ('Cloud', true, 6, NOW(), NOW()),
  ('คอมพิวเตอร์', true, 7, NOW(), NOW()),
  ('Hosting', true, 8, NOW(), NOW()),
  ('Hostname', true, 9, NOW(), NOW()),
  ('อื่นๆ', true, 99, NOW(), NOW());

-- หมวดหมู่คลังบัญชี (นอกเหนือจากหมวดตั้งต้นในโค้ด): คอมพิวเตอร์ / Hosting / Hostname
INSERT IGNORE INTO `dropdown_options` (`list`, `name`, `is_active`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('vault_category', 'คอมพิวเตอร์', true, 1, NOW(), NOW()),
  ('vault_category', 'Hosting', true, 2, NOW(), NOW()),
  ('vault_category', 'Hostname', true, 3, NOW(), NOW());
