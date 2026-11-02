-- ใบงานที่ทำหลายวัน (เช่น งานออกแบบ / ออกหน้างานต่างจังหวัด): ช่วงวันปฏิบัติงาน = work_start_on ถึง completed_on
-- → ชีต KPI แยก 1 แถวต่อวัน (work_skip_off_days = ไม่นับวันหยุดตามวันทำงาน / วันหยุดบริษัท)
ALTER TABLE `it_tickets`
  ADD COLUMN `work_start_on` DATE NULL,
  ADD COLUMN `work_skip_off_days` BOOLEAN NOT NULL DEFAULT true;

-- KPI ของแถวใบงานแยกต่อคน + ต่อวัน (เดิมต่อคน) — สร้าง index ใหม่ก่อนเพื่อให้ FK ticket_id มี index รองรับตลอด
CREATE UNIQUE INDEX `kpi_entries_ticket_user_day_unique` ON `kpi_entries`(`ticket_id`, `user_id`, `work_date`);
DROP INDEX `kpi_entries_ticket_user_unique` ON `kpi_entries`;
