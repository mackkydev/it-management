-- ย้อนกลับ 20261108090000_ticket_work_days (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — แถว KPI รายวันของใบงานเดียวกันเหลือแถวแรกต่อคน (สำรองก่อน)
DELETE k FROM `kpi_entries` k
  JOIN `kpi_entries` k2 ON k2.`ticket_id` = k.`ticket_id` AND k2.`user_id` = k.`user_id` AND k2.`id` < k.`id`
 WHERE k.`ticket_id` IS NOT NULL;
CREATE UNIQUE INDEX `kpi_entries_ticket_user_unique` ON `kpi_entries`(`ticket_id`, `user_id`);
DROP INDEX `kpi_entries_ticket_user_day_unique` ON `kpi_entries`;
ALTER TABLE `it_tickets` DROP COLUMN `work_skip_off_days`, DROP COLUMN `work_start_on`;
