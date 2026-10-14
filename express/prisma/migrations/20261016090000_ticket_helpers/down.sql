-- ย้อนกลับ: ต้องไม่มีแถว KPI ของผู้ร่วมดำเนินการ (ticket_id ซ้ำ) เหลืออยู่ก่อน
DELETE k FROM `kpi_entries` k JOIN `it_tickets` t ON t.id = k.ticket_id WHERE t.assignee_id IS NULL OR k.user_id <> t.assignee_id;
CREATE UNIQUE INDEX `kpi_entries_ticket_id_unique` ON `kpi_entries`(`ticket_id`);
DROP INDEX `kpi_entries_ticket_user_unique` ON `kpi_entries`;
DROP TABLE `it_ticket_helpers`;
