-- ข้อมูลหลัก Vendor + รายการส่งซ่อม (ส่งเครื่องให้ vendor / รับคืน) — ผูกใบแจ้งงานได้ และรายการในประวัติใบงานลิงก์กลับมาที่รายการส่งซ่อม

CREATE TABLE `vendors` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(255) NOT NULL,
    `tax_id` VARCHAR(20) NULL,
    `address` TEXT NOT NULL,
    `contact_name` VARCHAR(255) NOT NULL,
    `contact_phone` VARCHAR(50) NOT NULL,
    `vendor_type` VARCHAR(100) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `vendors_name_index`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE `repair_orders` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `uuid` CHAR(36) NOT NULL,
    `asset_id` BIGINT NULL,
    `ticket_id` BIGINT NULL,
    `item_no` VARCHAR(100) NULL,
    `item_name` VARCHAR(255) NOT NULL,
    `symptom` TEXT NOT NULL,
    `vendor_id` BIGINT NOT NULL,
    `sent_on` DATE NOT NULL,
    `sent_time` VARCHAR(5) NOT NULL,
    `sent_by_id` BIGINT NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'sent',
    `returned_at` DATETIME(0) NULL,
    `received_by_id` BIGINT NULL,
    `return_note` TEXT NULL,
    `asset_prev_status` VARCHAR(20) NULL,
    `cancelled_at` DATETIME(0) NULL,
    `cancelled_by_id` BIGINT NULL,
    `cancel_reason` TEXT NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `repair_orders_uuid_unique`(`uuid`),
    INDEX `repair_orders_status_sent_on_index`(`status`, `sent_on`),
    INDEX `repair_orders_asset_id_index`(`asset_id`),
    INDEX `repair_orders_ticket_id_index`(`ticket_id`),
    INDEX `repair_orders_vendor_id_index`(`vendor_id`),
    INDEX `repair_orders_sent_by_id_index`(`sent_by_id`),
    INDEX `repair_orders_received_by_id_index`(`received_by_id`),
    INDEX `repair_orders_created_by_index`(`created_by`),
    INDEX `repair_orders_cancelled_by_id_index`(`cancelled_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

CREATE TABLE `repair_order_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `repair_order_id` BIGINT NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `path` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `uploaded_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `repair_order_files_repair_order_id_index`(`repair_order_id`),
    INDEX `repair_order_files_uploaded_by_index`(`uploaded_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `it_ticket_events` ADD COLUMN `repair_order_id` BIGINT NULL;
CREATE INDEX `it_ticket_events_repair_order_id_index` ON `it_ticket_events`(`repair_order_id`);

ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_asset_id_foreign` FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_ticket_id_foreign` FOREIGN KEY (`ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_vendor_id_foreign` FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_sent_by_id_foreign` FOREIGN KEY (`sent_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_received_by_id_foreign` FOREIGN KEY (`received_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_cancelled_by_id_foreign` FOREIGN KEY (`cancelled_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `repair_orders` ADD CONSTRAINT `repair_orders_created_by_foreign` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `repair_order_files` ADD CONSTRAINT `repair_order_files_repair_order_id_foreign` FOREIGN KEY (`repair_order_id`) REFERENCES `repair_orders`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `repair_order_files` ADD CONSTRAINT `repair_order_files_uploaded_by_foreign` FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `it_ticket_events` ADD CONSTRAINT `it_ticket_events_repair_order_id_foreign` FOREIGN KEY (`repair_order_id`) REFERENCES `repair_orders`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- ประเภท Vendor ตั้งต้น (แก้ได้ที่ ข้อมูล Drop Down)
INSERT INTO `dropdown_options` (`list`, `name`, `sort_order`, `created_at`, `updated_at`) VALUES
  ('vendor_type', 'ผู้จำหน่าย', 1, NOW(), NOW()),
  ('vendor_type', 'ซ่อม', 2, NOW(), NOW()),
  ('vendor_type', 'ขาย', 3, NOW(), NOW()),
  ('vendor_type', 'อื่นๆ', 4, NOW(), NOW());
