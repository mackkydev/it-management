-- ย้อนกลับ 20261008090000_kpi_details (รันด้วย mysql client เอง)
ALTER TABLE `kpi_entries` DROP FOREIGN KEY `kpi_entries_ticket_id_foreign`;
DROP INDEX `kpi_entries_ticket_id_unique` ON `kpi_entries`;
ALTER TABLE `kpi_entries`
  DROP COLUMN `entry_type`, DROP COLUMN `ticket_id`, DROP COLUMN `requester_name`, DROP COLUMN `branch_name`,
  DROP COLUMN `service_type`, DROP COLUMN `solution`, DROP COLUMN `complexity`, DROP COLUMN `completed_date`;
