-- กลุ่ม admin (= เจ้าหน้าที่ IT หลังยุบกลุ่มฝ่าย IT) ดูแลระบบ + จัดการผู้ใช้ได้ แต่ไม่อนุมัติแทนหัวหน้า / ไม่ใช้ลายเซ็นคนอื่น / ไม่แก้ตั้งค่าระบบ-PIN กลาง
-- ensurePermissions() ไม่แตะการกำหนดสิทธิ์เดิม จึงถอดด้วย migration นี้ (สิทธิ์ที่มอบรายคนไว้คงเดิม) — สิทธิ์เหล่านี้เป็น locked (มอบได้เฉพาะ super_admin)
-- ย้อนกลับ: down.sql

DELETE rp FROM `role_permissions` rp
  JOIN `permissions` p ON p.`id` = rp.`permission_id`
 WHERE rp.`role` = 'admin'
   AND p.`key` IN ('tickets.approve_any', 'tickets.approve_own', 'leave.approve_any', 'signature.use', 'secrets.pin_manage', 'settings.manage');

-- ตัวเลือกเรื่อง "อื่นๆ" ย้ายไปอยู่กับ dropdowns.manage (GET/PUT /ticket-other-types)
UPDATE `permissions` SET `name_th` = 'ตั้งค่าระบบ (แจ้งเตือน, ความปลอดภัย, โลโก้)', `name_en` = 'System settings (notifications, security, logo)' WHERE `key` = 'settings.manage';
UPDATE `permissions` SET `name_th` = 'จัดการข้อมูล Drop Down (Computer Type, ยี่ห้อ, หมวดหมู่คลังบัญชี, ตัวเลือกเรื่อง "อื่นๆ")', `name_en` = 'Manage drop-down data (computer type, brand, vault category, "Other" ticket subjects)' WHERE `key` = 'dropdowns.manage';

INSERT INTO `audit_logs` (`actor_id`, `action`, `subject_type`, `subject_id`, `before`, `after`, `ip`, `created_at`)
SELECT NULL, 'access.defaults_tightened', 'permission_group', 'admin',
       JSON_OBJECT('permissions', JSON_ARRAY('tickets.approve_any', 'tickets.approve_own', 'leave.approve_any', 'signature.use', 'secrets.pin_manage', 'settings.manage')),
       JSON_OBJECT('permissions', JSON_ARRAY()), NULL, UTC_TIMESTAMP()
  FROM DUAL WHERE EXISTS (SELECT 1 FROM `permissions`);
