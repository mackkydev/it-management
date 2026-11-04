-- ประกาศข่าวสาร: การทำซ้ำ (ทุกวัน / สัปดาห์ / เดือน / ปี) + รูปหน้าปกและเอกสารแนบ
ALTER TABLE `announcements`
    ADD COLUMN `repeat_mode` VARCHAR(10) NOT NULL DEFAULT 'none',
    ADD COLUMN `repeat_weekday` TINYINT NULL,
    ADD COLUMN `repeat_day` TINYINT NULL,
    ADD COLUMN `repeat_month` TINYINT NULL;

CREATE TABLE `announcement_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `announcement_id` BIGINT NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `announcement_files_announcement_id_index`(`announcement_id`),
    INDEX `announcement_files_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `announcement_files` ADD CONSTRAINT `announcement_files_announcement_id_foreign` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `announcement_files` ADD CONSTRAINT `announcement_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
