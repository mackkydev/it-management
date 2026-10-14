-- ย้อนกลับ: เหลือวันละ 1 รายการ (เก็บของชุดตั้งต้นก่อน แล้ว id น้อยสุด) ก่อนคืน unique(date)
ALTER TABLE `branches` DROP FOREIGN KEY `branches_holiday_calendar_id_foreign`;
DROP INDEX `branches_holiday_calendar_id_index` ON `branches`;
ALTER TABLE `branches` DROP COLUMN `holiday_calendar_id`;

DELETE h FROM `company_holidays` h
  JOIN `holiday_calendars` c ON c.id = h.calendar_id
  JOIN `company_holidays` k ON k.`date` = h.`date` AND k.id <> h.id
  JOIN `holiday_calendars` kc ON kc.id = k.calendar_id
 WHERE (kc.is_default = true AND c.is_default = false) OR (kc.is_default = c.is_default AND k.id < h.id);
ALTER TABLE `company_holidays` DROP FOREIGN KEY `company_holidays_calendar_id_foreign`;
CREATE UNIQUE INDEX `company_holidays_date_unique` ON `company_holidays`(`date`);
DROP INDEX `company_holidays_calendar_date_unique` ON `company_holidays`;
ALTER TABLE `company_holidays` DROP COLUMN `calendar_id`;

DROP TABLE `holiday_calendars`;
