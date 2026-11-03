-- ระดับผู้ใช้ 6 ระดับ: ผู้ดูแลระบบสูงสุด > ผู้ดูแลระบบ > ผู้บริหาร (ใหม่) > ผู้จัดการฝ่าย > ผู้จัดการแผนก (manager เดิม) > พนักงาน

-- กลุ่มที่สร้างเองชื่อ "ผู้บริหาร" เดิมซ้ำกับระดับใหม่ — ลบเฉพาะเมื่อไม่มีสมาชิกและไม่มีสิทธิ์
DELETE g FROM `permission_groups` g
 WHERE g.`is_system` = false AND g.`name_th` = 'ผู้บริหาร'
   AND NOT EXISTS (SELECT 1 FROM `user_groups` ug WHERE ug.`group_key` = g.`key`)
   AND NOT EXISTS (SELECT 1 FROM `role_permissions` rp WHERE rp.`role` = g.`key`);

INSERT IGNORE INTO `permission_groups` (`key`, `name_th`, `name_en`, `is_system`, `sort_order`, `created_at`, `updated_at`)
VALUES ('executive', 'ผู้บริหาร', 'Executive', true, 2, NOW(), NOW());

-- ผู้ตรวจสอบ (อ่านอย่างเดียว) สำหรับ audit / ผู้ตรวจสอบภายนอก — สิทธิ์คำนวณในโค้ด (permissionsOf) ไม่เก็บใน role_permissions จึงไม่ถูกนับเป็นผู้อนุมัติ/ผู้รับแจ้งเตือน
INSERT IGNORE INTO `permission_groups` (`key`, `name_th`, `name_en`, `is_system`, `sort_order`, `created_at`, `updated_at`)
VALUES ('auditor', 'ผู้ตรวจสอบ (อ่านอย่างเดียว)', 'Auditor (read-only)', true, 6, NOW(), NOW());

-- สิทธิ์ตั้งต้นของผู้บริหาร = ของผู้จัดการฝ่าย (ปรับเพิ่มที่หน้าสิทธิ์ตามกลุ่ม)
INSERT IGNORE INTO `role_permissions` (`role`, `permission_id`, `created_at`)
SELECT 'executive', rp.`permission_id`, NOW() FROM `role_permissions` rp WHERE rp.`role` = 'division_manager';

-- เปลี่ยนชื่อที่แสดงของ manager (เฉพาะที่ยังไม่ได้แก้ชื่อเอง)
UPDATE `permission_groups` SET `name_th` = 'ผู้จัดการแผนก' WHERE `key` = 'manager' AND `name_th` = 'ผู้จัดการ';
UPDATE `permission_groups` SET `name_en` = 'Department manager' WHERE `key` = 'manager' AND `name_en` = 'Manager';

-- ลำดับ: 6 ระดับก่อน แล้วจึงกลุ่มที่สร้างเอง (ลำดับเดิม)
UPDATE `permission_groups` SET `sort_order` = `sort_order` + 10 WHERE `is_system` = false;
UPDATE `permission_groups` SET `sort_order` = 3 WHERE `key` = 'division_manager';
UPDATE `permission_groups` SET `sort_order` = 4 WHERE `key` = 'manager';
UPDATE `permission_groups` SET `sort_order` = 5 WHERE `key` = 'viewer';
