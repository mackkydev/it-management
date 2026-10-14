-- ผู้ร่วมดำเนินการในใบแจ้งงาน (เจ้าหน้าที่ IT ที่ผู้รับงานเลือกเพิ่ม) — แต่ละคนมีแถว KPI ของตัวเอง
CREATE TABLE `it_ticket_helpers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `it_ticket_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `added_by` BIGINT NULL,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    UNIQUE INDEX `it_ticket_helpers_ticket_user_unique`(`it_ticket_id`, `user_id`),
    INDEX `it_ticket_helpers_user_id_index`(`user_id`),
    INDEX `it_ticket_helpers_added_by_index`(`added_by`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `it_ticket_helpers` ADD CONSTRAINT `it_ticket_helpers_it_ticket_id_foreign` FOREIGN KEY (`it_ticket_id`) REFERENCES `it_tickets`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `it_ticket_helpers` ADD CONSTRAINT `it_ticket_helpers_user_id_foreign` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE `it_ticket_helpers` ADD CONSTRAINT `it_ticket_helpers_added_by_foreign` FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- KPI ของแถวใบงาน: 1 แถวต่อ (ใบงาน, เจ้าหน้าที่) แทน 1 แถวต่อใบงาน (สร้าง index ใหม่ก่อน — FK ticket_id ต้องมี index เสมอ)
CREATE UNIQUE INDEX `kpi_entries_ticket_user_unique` ON `kpi_entries`(`ticket_id`, `user_id`);
DROP INDEX `kpi_entries_ticket_id_unique` ON `kpi_entries`;
