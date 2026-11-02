-- ประสิทธิภาพเมื่อข้อมูลโต: index ที่ query จริงใช้ + ตัวนับเวอร์ชันข้อมูลสำหรับ /sync/version (เพิ่มอย่างเดียว ไม่แตะข้อมูลเดิม)

-- notifications: รหัสเรื่องของแจ้งเตือน (ใบงาน / ใบลา / จองรถ / ยืม / VPN / ZOOM — 1 แจ้งเตือนมีรหัสเดียว) เป็นคอลัมน์ที่ระบบคำนวณจาก data
--   markNoticesRead() / ลบแจ้งเตือนของใบงาน เดิมต้อง parse JSON ทุกแถวที่ยังไม่อ่านของทุกคน → ใช้ index นี้แทน
ALTER TABLE `notifications`
    ADD COLUMN `subject_ref` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci
        GENERATED ALWAYS AS (IF(JSON_VALID(`data`), COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.ticket_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.leave_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.vehicle_booking_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.loan_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.vpn_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.zoom_booking_id'))), NULL)) STORED;
CREATE INDEX `notifications_subject_ref_read_at_index` ON `notifications`(`subject_ref`, `read_at`);
-- กระดิ่ง: รายการล่าสุดของผู้ใช้ (ORDER BY created_at DESC) / จำนวนที่ยังไม่อ่าน — แทน index เดิม (notifiable_type, notifiable_id) ที่เป็นส่วนหน้าของ index ใหม่
CREATE INDEX `notifications_notifiable_created_at_index` ON `notifications`(`notifiable_type`, `notifiable_id`, `created_at`);
CREATE INDEX `notifications_notifiable_read_at_index` ON `notifications`(`notifiable_type`, `notifiable_id`, `read_at`);
DROP INDEX `notifications_notifiable_type_notifiable_id_index` ON `notifications`;

-- ใบแจ้งงาน: ตัวกรองวันที่แจ้ง (รายการทั้งหมด / KPI ตามเดือนที่แจ้ง)
CREATE INDEX `it_tickets_requested_at_index` ON `it_tickets`(`requested_at`);

-- บันทึกการเปลี่ยนแปลง: กรองตามการกระทำ (action LIKE 'xxx%') + รายการการกระทำ (DISTINCT action)
CREATE INDEX `audit_logs_action_index` ON `audit_logs`(`action`);

-- ตัวนับเวอร์ชันข้อมูล: API เพิ่มค่าเมื่อมีการบันทึกตารางที่หน้าจอแสดงผล — /sync/version อ่านแถวเดียวแทนการนับทุกตาราง (ใช้ได้หลาย instance)
CREATE TABLE `sync_versions` (
    `name` VARCHAR(32) NOT NULL,
    `version` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME(0) NULL,

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci;
INSERT INTO `sync_versions` (`name`, `version`, `updated_at`) VALUES ('data', 0, UTC_TIMESTAMP());
