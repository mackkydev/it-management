-- หมวดหมู่สัญญา vendor (ข้อมูลหลัก) + สัญญาเลือกหมวดหมู่ได้ (ไม่บังคับ) — ลบหมวดหมู่ = สัญญาไม่ระบุหมวดหมู่
CREATE TABLE `contract_categories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `contract_categories_name_unique`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `contracts` ADD COLUMN `category_id` BIGINT NULL;
CREATE INDEX `contracts_category_id_index` ON `contracts`(`category_id`);
ALTER TABLE `contracts` ADD CONSTRAINT `contracts_category_id_foreign` FOREIGN KEY (`category_id`) REFERENCES `contract_categories`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
