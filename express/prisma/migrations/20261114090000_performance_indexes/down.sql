-- ย้อนกลับ 20261114090000_performance_indexes (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไม่มีข้อมูลผู้ใช้หาย
CREATE INDEX `notifications_notifiable_type_notifiable_id_index` ON `notifications`(`notifiable_type`, `notifiable_id`);
DROP INDEX `notifications_notifiable_read_at_index` ON `notifications`;
DROP INDEX `notifications_notifiable_created_at_index` ON `notifications`;
DROP INDEX `notifications_subject_ref_read_at_index` ON `notifications`;
ALTER TABLE `notifications` DROP COLUMN `subject_ref`;
DROP INDEX `it_tickets_requested_at_index` ON `it_tickets`;
DROP INDEX `audit_logs_action_index` ON `audit_logs`;
DROP TABLE IF EXISTS `sync_versions`;
