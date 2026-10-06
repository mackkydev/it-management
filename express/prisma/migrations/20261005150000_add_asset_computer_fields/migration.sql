-- ทะเบียนคอมพิวเตอร์ (หมวด COMPUTER) + สาขาของสินทรัพย์ + Work Group ของสาขา — เพิ่มคอลัมน์อย่างเดียว (ทุกคอลัมน์ว่างได้)
-- AlterTable
ALTER TABLE `assets` ADD COLUMN `antivirus` VARCHAR(100) NULL,
    ADD COLUMN `branch_id` BIGINT NULL,
    ADD COLUMN `computer_type` VARCHAR(30) NULL,
    ADD COLUMN `cpu_tag` VARCHAR(100) NULL,
    ADD COLUMN `department` VARCHAR(100) NULL,
    ADD COLUMN `email_365` VARCHAR(255) NULL,
    ADD COLUMN `ip_address` VARCHAR(45) NULL,
    ADD COLUMN `mac_address` VARCHAR(50) NULL,
    ADD COLUMN `monitor_tag` VARCHAR(255) NULL,
    ADD COLUMN `notebook_tag` VARCHAR(100) NULL,
    ADD COLUMN `office` VARCHAR(100) NULL,
    ADD COLUMN `os` VARCHAR(100) NULL,
    ADD COLUMN `received_date` DATE NULL,
    ADD COLUMN `start_use_date` DATE NULL,
    ADD COLUMN `user_name` VARCHAR(255) NULL,
    ADD COLUMN `work_group` VARCHAR(50) NULL;

-- AlterTable
ALTER TABLE `branches` ADD COLUMN `work_group` VARCHAR(50) NULL;

-- CreateIndex
CREATE INDEX `assets_branch_id_index` ON `assets`(`branch_id`);

-- CreateIndex
CREATE UNIQUE INDEX `branches_work_group_unique` ON `branches`(`work_group`);

-- AddForeignKey
ALTER TABLE `assets` ADD CONSTRAINT `assets_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

