-- รายการส่งซ่อม: อะไหล่ที่ร้านเปลี่ยน (กรอกตอนรับเครื่องคืน, หลายแถว)
CREATE TABLE `repair_order_parts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `repair_order_id` BIGINT NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(0) NULL,

    INDEX `repair_order_parts_repair_order_id_index`(`repair_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `repair_order_parts` ADD CONSTRAINT `repair_order_parts_repair_order_id_foreign` FOREIGN KEY (`repair_order_id`) REFERENCES `repair_orders`(`id`) ON DELETE CASCADE ON UPDATE RESTRICT;
