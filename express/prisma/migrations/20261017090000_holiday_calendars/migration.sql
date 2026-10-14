-- ปฏิทินวันหยุดแยกชุด (เช่น สำนักงานใหญ่ / สำนักงานโรงงาน — ตามประกาศ HR แยกฉบับ): วันหยุดอยู่ในชุดใดชุดหนึ่ง, สาขาเลือกใช้ 1 ชุด
CREATE TABLE `holiday_calendars` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `holiday_calendars_name_unique`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ชุดตั้งต้น (สาขาที่ยังไม่เลือกชุด / ผู้ใช้ไม่มีสาขา ใช้ชุดนี้) — วันหยุดเดิมทั้งหมดย้ายเข้าชุดนี้
INSERT INTO `holiday_calendars` (`name`, `is_default`, `sort_order`, `created_at`, `updated_at`) VALUES ('วันหยุดบริษัท', true, 0, NOW(), NOW());

ALTER TABLE `company_holidays` ADD COLUMN `calendar_id` BIGINT NULL;
UPDATE `company_holidays` SET `calendar_id` = (SELECT `id` FROM `holiday_calendars` WHERE `is_default` = true LIMIT 1);
ALTER TABLE `company_holidays` MODIFY `calendar_id` BIGINT NOT NULL;
ALTER TABLE `company_holidays` ADD CONSTRAINT `company_holidays_calendar_id_foreign` FOREIGN KEY (`calendar_id`) REFERENCES `holiday_calendars`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
-- วันเดียวกันมีได้ชุดละ 1 รายการ
CREATE UNIQUE INDEX `company_holidays_calendar_date_unique` ON `company_holidays`(`calendar_id`, `date`);
DROP INDEX `company_holidays_date_unique` ON `company_holidays`;

ALTER TABLE `branches` ADD COLUMN `holiday_calendar_id` BIGINT NULL;
CREATE INDEX `branches_holiday_calendar_id_index` ON `branches`(`holiday_calendar_id`);
ALTER TABLE `branches` ADD CONSTRAINT `branches_holiday_calendar_id_foreign` FOREIGN KEY (`holiday_calendar_id`) REFERENCES `holiday_calendars`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
