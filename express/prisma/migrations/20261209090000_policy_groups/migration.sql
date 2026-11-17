-- นโยบายที่ต้องยอมรับแสดงได้หลายเรื่องพร้อมกัน: แต่ละเรื่อง (policy_groups) มีหลายฉบับ (policy_versions — ฉบับที่คัดลอกมาอยู่เรื่องเดียวกัน)
--   current_version = ฉบับของเรื่องนั้นที่แสดงให้ผู้ใช้ (null = ไม่แสดง), sort_order = ลำดับที่ให้ยอมรับ
-- + นโยบายอื่นๆ มีหัวข้อ/รายละเอียดเหมือนนโยบายที่ต้องยอมรับ (other_policies.sections)
CREATE TABLE `policy_groups` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `current_version` INTEGER NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `seed_title` VARCHAR(200) NULL,

    INDEX `policy_groups_current_version_index`(`current_version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `policy_versions`
    ADD COLUMN `group_id` BIGINT NULL AFTER `version`,
    ADD INDEX `policy_versions_group_id_index`(`group_id`);

-- ฉบับเดิม: ชื่อเดียวกัน = เรื่องเดียวกัน (ฉบับที่คัดลอกมาใช้ชื่อเดิม)
INSERT INTO `policy_groups` (`seed_title`, `sort_order`, `created_at`, `updated_at`)
SELECT `title`, 0, MIN(`created_at`), NOW() FROM `policy_versions` GROUP BY `title` ORDER BY MIN(`version`);

UPDATE `policy_versions` v JOIN `policy_groups` g ON g.`seed_title` = v.`title` SET v.`group_id` = g.`id`;

-- ฉบับที่แสดงอยู่เดิม (app_settings.system_policy.version) = ฉบับที่แสดงของเรื่องนั้น ลำดับที่ 1
UPDATE `policy_groups` g
  JOIN `policy_versions` v ON v.`group_id` = g.`id`
  JOIN `app_settings` s ON s.`key` = 'system_policy' AND CAST(JSON_EXTRACT(s.`value`, '$.version') AS SIGNED) = v.`version`
   SET g.`current_version` = v.`version`, g.`sort_order` = 1;

ALTER TABLE `policy_groups` DROP COLUMN `seed_title`;

ALTER TABLE `policy_versions` MODIFY `group_id` BIGINT NOT NULL;
ALTER TABLE `policy_versions` ADD CONSTRAINT `policy_versions_group_id_foreign` FOREIGN KEY (`group_id`) REFERENCES `policy_groups`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `policy_groups` ADD CONSTRAINT `policy_groups_current_version_foreign` FOREIGN KEY (`current_version`) REFERENCES `policy_versions`(`version`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `other_policies` ADD COLUMN `sections` JSON NULL AFTER `description`;
