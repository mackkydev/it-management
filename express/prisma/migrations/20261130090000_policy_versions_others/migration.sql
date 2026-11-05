-- นโยบายหลายฉบับ: แต่ละฉบับมีชื่อ ไฟล์แนบ และประวัติการยอมรับของตัวเอง + นโยบายอื่นๆ (เอกสารให้เปิดอ่าน ไม่ต้องยอมรับ)
ALTER TABLE `policy_versions`
    ADD COLUMN `title` VARCHAR(200) NOT NULL DEFAULT '' AFTER `version`,
    ADD COLUMN `published_at` DATETIME(0) NULL,
    ADD COLUMN `created_by` BIGINT NULL,
    ADD COLUMN `updated_at` DATETIME(0) NULL,
    ADD INDEX `policy_versions_created_by_index`(`created_by`),
    ADD CONSTRAINT `policy_versions_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- ฉบับปัจจุบันที่ยังไม่มีสำเนาเนื้อหา
INSERT IGNORE INTO `policy_versions` (`version`, `sections`, `created_at`)
SELECT CAST(JSON_EXTRACT(`value`, '$.version') AS SIGNED), COALESCE(JSON_EXTRACT(`value`, '$.sections'), JSON_ARRAY()), NOW()
  FROM `app_settings`
 WHERE `key` = 'system_policy' AND CAST(JSON_EXTRACT(`value`, '$.version') AS SIGNED) > 0;

-- ฉบับที่มีคนยอมรับแล้วแต่ไม่มีสำเนาเนื้อหา — เก็บเป็นรายการว่างเพื่อให้เรียกดูรายชื่อได้
INSERT IGNORE INTO `policy_versions` (`version`, `sections`, `created_at`)
SELECT DISTINCT `version`, JSON_ARRAY(), NOW() FROM `policy_acceptances`;

-- ฉบับเดิมทั้งหมดเคยประกาศใช้แล้ว
UPDATE `policy_versions` SET `title` = 'นโยบายการใช้งานระบบ', `published_at` = COALESCE(`created_at`, NOW()), `updated_at` = `created_at`;

-- ไฟล์แนบแยกตามฉบับ: ไฟล์เดิมเป็นของฉบับปัจจุบัน
ALTER TABLE `policy_files`
    ADD COLUMN `version` INTEGER NULL AFTER `id`,
    ADD INDEX `policy_files_version_index`(`version`),
    ADD CONSTRAINT `policy_files_version_foreign` FOREIGN KEY (`version`) REFERENCES `policy_versions`(`version`) ON DELETE RESTRICT ON UPDATE RESTRICT;

UPDATE `policy_files` f
  JOIN `app_settings` s ON s.`key` = 'system_policy'
   SET f.`version` = CAST(JSON_EXTRACT(s.`value`, '$.version') AS SIGNED)
 WHERE CAST(JSON_EXTRACT(s.`value`, '$.version') AS SIGNED) > 0;

CREATE TABLE `other_policies` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `other_policies_created_by_index`(`created_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE `other_policy_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `other_policy_id` BIGINT NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `other_policy_files_other_policy_id_index`(`other_policy_id`),
    INDEX `other_policy_files_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `other_policies` ADD CONSTRAINT `other_policies_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `other_policy_files` ADD CONSTRAINT `other_policy_files_other_policy_id_foreign` FOREIGN KEY (`other_policy_id`) REFERENCES `other_policies`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `other_policy_files` ADD CONSTRAINT `other_policy_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
