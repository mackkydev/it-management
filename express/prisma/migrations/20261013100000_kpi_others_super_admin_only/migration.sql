-- KPI ของคนอื่น (ดู / แก้ไข) เฉพาะผู้ดูแลระบบสูงสุด (= หัวหน้า IT, ผ่านทุกสิทธิ์) — ผู้ดูแลระบบ (admin) เห็นเฉพาะ KPI ของตัวเอง
DELETE FROM `role_permissions`
 WHERE `role` = 'admin'
   AND `permission_id` IN (SELECT `id` FROM `permissions` WHERE `key` IN ('kpi.view_all', 'kpi.edit_all'));
