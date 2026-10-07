-- ย้อนกลับ 20261013090000_merge_legacy_it_groups (รันด้วย mysql client เอง)
-- คืนชื่อตำแหน่ง + สร้างกลุ่มฝ่าย IT เดิม (ว่าง) — ตำแหน่งผู้ใช้ / สิทธิ์ของกลุ่ม / สมาชิกเดิม ต้องกู้จากไฟล์สำรองก่อน migrate
UPDATE `permission_groups` SET `name_th` = 'ผู้ดูแลระบบ' WHERE `key` = 'super_admin' AND `name_th` = 'ผู้ดูแลระบบสูงสุด';
UPDATE `permission_groups` SET `name_th` = 'ผู้ดูแลระบบรอง' WHERE `key` = 'admin' AND `name_th` = 'ผู้ดูแลระบบ';
INSERT IGNORE INTO `permission_groups` (`key`, `name_th`, `name_en`, `is_system`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('it_staff', 'เจ้าหน้าที่ IT (เดิม)', 'IT staff (legacy)', false, 10, UTC_TIMESTAMP(), UTC_TIMESTAMP()),
  ('it_head', 'หัวหน้า IT (เดิม)', 'IT head (legacy)', false, 11, UTC_TIMESTAMP(), UTC_TIMESTAMP());
