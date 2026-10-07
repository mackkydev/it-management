-- ยุบกลุ่มฝ่าย IT เดิมเข้าตำแหน่ง: หัวหน้า IT (it_head) → ผู้ดูแลระบบสูงสุด (super_admin), เจ้าหน้าที่ IT (it_staff) → ผู้ดูแลระบบ (admin)
-- ช่อง is_it_staff / is_it_head (หน้าที่ในใบแจ้งงาน) คงไว้เหมือนเดิม

UPDATE `users` SET `role` = 'super_admin'
 WHERE `role` <> 'super_admin' AND `id` IN (SELECT `user_id` FROM `user_groups` WHERE `group_key` = 'it_head');

UPDATE `users` SET `role` = 'admin'
 WHERE `role` NOT IN ('super_admin', 'admin') AND `id` IN (SELECT `user_id` FROM `user_groups` WHERE `group_key` = 'it_staff');

-- ลบกลุ่ม + สิทธิ์ของกลุ่ม (สมาชิกใน user_groups ลบตาม FK cascade)
DELETE FROM `role_permissions` WHERE `role` IN ('it_staff', 'it_head');
DELETE FROM `permission_groups` WHERE `key` IN ('it_staff', 'it_head');

-- ชื่อตำแหน่งใหม่ (เฉพาะที่ยังเป็นชื่อเดิม — ชื่อที่ผู้ใช้แก้เองไม่แตะ)
UPDATE `permission_groups` SET `name_th` = 'ผู้ดูแลระบบสูงสุด' WHERE `key` = 'super_admin' AND `name_th` = 'ผู้ดูแลระบบ';
UPDATE `permission_groups` SET `name_th` = 'ผู้ดูแลระบบ' WHERE `key` = 'admin' AND `name_th` = 'ผู้ดูแลระบบรอง';
