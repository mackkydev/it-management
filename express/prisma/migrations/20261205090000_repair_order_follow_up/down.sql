ALTER TABLE `notifications`
    MODIFY COLUMN `subject_ref` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci
        GENERATED ALWAYS AS (IF(JSON_VALID(`data`), COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.ticket_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.leave_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.vehicle_booking_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.loan_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.vpn_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.zoom_booking_id'))), NULL)) STORED;
DROP INDEX `repair_orders_status_follow_up_on_index` ON `repair_orders`;
ALTER TABLE `repair_orders` DROP COLUMN `follow_up_notified_for`, DROP COLUMN `follow_up_on`, DROP COLUMN `follow_up_days`;
