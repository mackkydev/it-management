-- Fixed Assets จาก STEC SyteLine API (สำเนาอ่านอย่างเดียว) — services/fixed-asset-sync.ts
--   fixed_assets = 1 แถวต่อ (site, fanum), ผูกกับ assets ได้ (auto ตามเลขที่ทรัพย์สิน / manual)
--   fixed_asset_classdepts = รหัสหมวด-แผนกของแต่ละ site, fixed_asset_sync_runs = ประวัติการซิงค์ (ห้ามแก้/ลบผ่าน API)

CREATE TABLE `fixed_assets` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `site` VARCHAR(10) NOT NULL,
    `fanum` VARCHAR(50) NOT NULL,
    `branch_id` BIGINT NULL,
    `site_name` VARCHAR(255) NULL,
    `description` VARCHAR(500) NULL,
    `fa_class` VARCHAR(20) NULL,
    `fa_dept` VARCHAR(20) NULL,
    `fa_type` VARCHAR(20) NULL,
    `fa_status` VARCHAR(20) NULL,
    `fa_location` VARCHAR(255) NULL,
    `acquired_on` DATE NULL,
    `depr_start_on` DATE NULL,
    `disposed_on` DATE NULL,
    `acq_cost` DECIMAL(18, 2) NULL,
    `accum_depr` DECIMAL(18, 2) NULL,
    `nbv` DECIMAL(18, 2) NULL,
    `salvage` DECIMAL(18, 2) NULL,
    `depr_method` VARCHAR(20) NULL,
    `depr_rate` DECIMAL(9, 4) NULL,
    `useful_life` INT NULL,
    `source_data` JSON NOT NULL,
    `row_hash` CHAR(64) NOT NULL,
    `source_recorded_at` DATETIME(0) NULL,
    `as_of` DATE NOT NULL,
    `asset_id` BIGINT NULL,
    `link_source` VARCHAR(10) NULL,
    `linked_by` BIGINT NULL,
    `missing_since` DATETIME(0) NULL,
    `first_synced_at` DATETIME(0) NOT NULL,
    `synced_at` DATETIME(0) NOT NULL,
    `changed_at` DATETIME(0) NULL,

    UNIQUE INDEX `fixed_assets_site_fanum_unique`(`site`, `fanum`),
    INDEX `fixed_assets_fanum_index`(`fanum`),
    INDEX `fixed_assets_asset_id_index`(`asset_id`),
    INDEX `fixed_assets_branch_id_index`(`branch_id`),
    INDEX `fixed_assets_linked_by_index`(`linked_by`),
    INDEX `fixed_assets_fa_status_index`(`fa_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE `fixed_asset_classdepts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `site` VARCHAR(10) NOT NULL,
    `class_dept` VARCHAR(30) NOT NULL,
    `description` VARCHAR(255) NULL,
    `synced_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `fixed_asset_classdepts_site_class_dept_unique`(`site`, `class_dept`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE `fixed_asset_sync_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `run_trigger` VARCHAR(10) NOT NULL,
    `triggered_by` BIGINT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'running',
    `stats` JSON NULL,
    `error` TEXT NULL,
    `started_at` DATETIME(0) NOT NULL,
    `finished_at` DATETIME(0) NULL,

    INDEX `fixed_asset_sync_runs_started_at_index`(`started_at`),
    INDEX `fixed_asset_sync_runs_triggered_by_index`(`triggered_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `fixed_assets` ADD CONSTRAINT `fixed_assets_linked_by_foreign` FOREIGN KEY (`linked_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `fixed_asset_sync_runs` ADD CONSTRAINT `fixed_asset_sync_runs_triggered_by_foreign` FOREIGN KEY (`triggered_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
