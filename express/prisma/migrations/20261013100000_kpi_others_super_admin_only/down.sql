-- ย้อนกลับ 20261013100000_kpi_others_super_admin_only (รันด้วย mysql client เอง)
INSERT IGNORE INTO `role_permissions` (`role`, `permission_id`, `created_at`)
  SELECT 'admin', `id`, UTC_TIMESTAMP() FROM `permissions` WHERE `key` IN ('kpi.view_all', 'kpi.edit_all');
