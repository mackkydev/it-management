-- KPI ฝ่าย IT ตามไฟล์ Template-KPI-IT (Part2 Details): แถวงาน / แถววันหยุด / แถวที่ผูกใบแจ้งงาน
-- work_date = วันที่แจ้ง, details = รายการ (แถววันหยุด = ชื่อวันหยุด), user_id = ผู้รับแจ้ง (เจ้าของ KPI)
-- แถวที่ผูกใบแจ้งงาน (ticket_id): ข้อมูลอื่นอ่านจากใบงานจริง — เก็บเฉพาะประเภทการแจ้ง + Complexity
ALTER TABLE `kpi_entries`
  ADD COLUMN `entry_type` VARCHAR(10) NOT NULL DEFAULT 'work',
  ADD COLUMN `ticket_id` BIGINT NULL,
  ADD COLUMN `requester_name` VARCHAR(255) NULL,
  ADD COLUMN `branch_name` VARCHAR(100) NULL,
  ADD COLUMN `service_type` VARCHAR(40) NULL,
  ADD COLUMN `solution` TEXT NULL,
  ADD COLUMN `complexity` DECIMAL(3, 1) NULL,
  ADD COLUMN `completed_date` DATE NULL;

CREATE UNIQUE INDEX `kpi_entries_ticket_id_unique` ON `kpi_entries`(`ticket_id`);
ALTER TABLE `kpi_entries` ADD CONSTRAINT `kpi_entries_ticket_id_foreign` FOREIGN KEY (`ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
