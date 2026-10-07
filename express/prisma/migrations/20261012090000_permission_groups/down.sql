-- ย้อนกลับ 20261012090000_permission_groups (รันด้วย mysql client เอง)
-- หมายเหตุ: ตำแหน่ง "เจ้าหน้าที่ IT" (role it_staff) เดิมแปลงเป็น viewer + is_it_staff แล้ว — ย้อนกลับไม่ได้ (สิทธิ์ยังเท่าเดิมผ่าน flag)
-- super_admin ที่เป็น API User ย้อนเป็น admin ได้ (ระบบเดิมจำกัด API User ไว้ที่ manager/viewer — ตรวจ/แก้รายคนเองหลังย้อนกลับ)
UPDATE `users` SET `role` = 'admin' WHERE `role` = 'super_admin';
DELETE FROM `role_permissions` WHERE `role` NOT IN ('admin', 'division_manager', 'manager', 'viewer', 'it_staff', 'it_head');
DELETE FROM `app_settings` WHERE `key` IN ('permission_expiry');
ALTER TABLE `user_groups` DROP FOREIGN KEY `user_groups_user_id_foreign`;
ALTER TABLE `user_groups` DROP FOREIGN KEY `user_groups_group_key_foreign`;
ALTER TABLE `user_groups` DROP FOREIGN KEY `user_groups_created_by_foreign`;
DROP TABLE `user_groups`;
DROP TABLE `permission_groups`;
ALTER TABLE `user_permissions` DROP COLUMN `expires_on`;
