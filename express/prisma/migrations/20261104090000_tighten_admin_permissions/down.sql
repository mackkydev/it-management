-- ย้อนกลับ 20261104090000_tighten_admin_permissions (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — คืนสิทธิ์ให้กลุ่ม admin
INSERT IGNORE INTO `role_permissions` (`role`, `permission_id`, `created_at`)
SELECT 'admin', p.`id`, UTC_TIMESTAMP() FROM `permissions` p
 WHERE p.`key` IN ('tickets.approve_any', 'tickets.approve_own', 'leave.approve_any', 'signature.use', 'secrets.pin_manage', 'settings.manage');
UPDATE `permissions` SET `name_th` = 'ตั้งค่าระบบ (แจ้งเตือน, ประเภทงาน, โลโก้, ลำดับเมนู)', `name_en` = 'System settings (notifications, ticket types, logo, menu order)' WHERE `key` = 'settings.manage';
UPDATE `permissions` SET `name_th` = 'จัดการข้อมูล Drop Down (Computer Type, ยี่ห้อ, หมวดหมู่คลังบัญชี)', `name_en` = 'Manage drop-down data (computer type, brand, vault category)' WHERE `key` = 'dropdowns.manage';
