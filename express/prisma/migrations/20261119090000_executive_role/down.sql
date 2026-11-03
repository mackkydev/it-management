-- ย้อนกลับ 20261119090000_executive_role (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ผู้ใช้ระดับผู้บริหารกลับเป็นผู้จัดการฝ่าย, กลุ่มที่สร้างเอง "ผู้บริหาร" เดิมไม่ถูกสร้างคืน (ไม่มีสมาชิก/สิทธิ์)
UPDATE `users` SET `role` = 'division_manager' WHERE `role` = 'executive';
UPDATE `users` SET `role` = 'viewer' WHERE `role` = 'auditor';
DELETE FROM `permission_groups` WHERE `key` = 'auditor';
DELETE FROM `user_groups` WHERE `group_key` = 'executive';
DELETE FROM `role_permissions` WHERE `role` = 'executive';
DELETE FROM `permission_groups` WHERE `key` = 'executive';
UPDATE `permission_groups` SET `name_th` = 'ผู้จัดการ' WHERE `key` = 'manager' AND `name_th` = 'ผู้จัดการแผนก';
UPDATE `permission_groups` SET `name_en` = 'Manager' WHERE `key` = 'manager' AND `name_en` = 'Department manager';
UPDATE `permission_groups` SET `sort_order` = 2 WHERE `key` = 'division_manager';
UPDATE `permission_groups` SET `sort_order` = 3 WHERE `key` = 'manager';
UPDATE `permission_groups` SET `sort_order` = 4 WHERE `key` = 'viewer';
UPDATE `permission_groups` SET `sort_order` = `sort_order` - 10 WHERE `is_system` = false AND `sort_order` >= 10;
