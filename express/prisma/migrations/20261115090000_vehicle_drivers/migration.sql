-- จองรถ: คนขับรถ (ผู้จัดคิวเลือกให้เมื่อผู้จองติ๊ก "คนขับรถ") + เหตุผลการยกเลิก (ผู้จัดคิวยกเลิกแทนผู้จอง) — เพิ่มอย่างเดียว (additive)

-- CreateTable
CREATE TABLE `vehicle_drivers` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(150) NOT NULL,
    `nickname` VARCHAR(50) NULL,
    `branch_id` BIGINT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NULL,
    `updated_at` DATETIME(0) NULL,

    INDEX `vehicle_drivers_branch_id_index`(`branch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;

ALTER TABLE `vehicle_drivers` ADD CONSTRAINT `vehicle_drivers_branch_id_foreign` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;

-- AlterTable: ผู้จองขอคนขับ / คนขับที่ผู้จัดคิวเลือก / เหตุผลที่ยกเลิก
ALTER TABLE `vehicle_bookings`
    ADD COLUMN `needs_driver` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `driver_id` BIGINT NULL,
    ADD COLUMN `cancel_reason` VARCHAR(1000) NULL;
CREATE INDEX `vehicle_bookings_driver_id_start_on_end_on_index` ON `vehicle_bookings`(`driver_id`, `start_on`, `end_on`);
ALTER TABLE `vehicle_bookings` ADD CONSTRAINT `vehicle_bookings_driver_id_foreign` FOREIGN KEY (`driver_id`) REFERENCES `vehicle_drivers`(`id`) ON DELETE SET NULL ON UPDATE RESTRICT;
