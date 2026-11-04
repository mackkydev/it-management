-- เอกสารการยอมรับนโยบาย: ตราชื่อ-สกุล + สำเนาลายเซ็น, เนื้อหาแต่ละฉบับ, ไฟล์แนบประกาศ
ALTER TABLE `policy_acceptances`
    ADD COLUMN `name_stamp` VARCHAR(255) NULL,
    ADD COLUMN `signature_path` VARCHAR(255) NULL,
    ADD COLUMN `signature_at` DATETIME(0) NULL;

-- การยอมรับเดิม: ประทับชื่อปัจจุบันของผู้ใช้ (ลายเซ็นคงว่าง — แสดงเมื่อผู้ใช้อัปโหลดครั้งถัดไป)
UPDATE `policy_acceptances` a JOIN `users` u ON u.`id` = a.`user_id` SET a.`name_stamp` = u.`name`;

CREATE TABLE `policy_versions` (
    `version` INTEGER NOT NULL,
    `sections` JSON NOT NULL,
    `created_at` DATETIME(0) NULL,

    PRIMARY KEY (`version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE `policy_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `original_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `policy_files_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `policy_files` ADD CONSTRAINT `policy_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
