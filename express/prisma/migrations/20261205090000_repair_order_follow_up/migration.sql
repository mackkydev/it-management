-- รายการส่งซ่อม: แจ้งเตือนตามงาน — จำนวนวันหลังวันที่ส่งซ่อม (ตั้งต้น 7) → ถึงกำหนดแล้วยังไม่รับคืน = แจ้งที่กระดิ่ง + ตัวเลขเมนู
ALTER TABLE `repair_orders`
    ADD COLUMN `follow_up_days` SMALLINT NOT NULL DEFAULT 7,
    ADD COLUMN `follow_up_on` DATE GENERATED ALWAYS AS (DATE_ADD(`sent_on`, INTERVAL `follow_up_days` DAY)) STORED,
    -- แจ้งไปแล้วสำหรับวันกำหนดใด (เปลี่ยนจำนวนวัน = วันกำหนดใหม่ แจ้งอีกครั้ง)
    ADD COLUMN `follow_up_notified_for` DATE NULL;
CREATE INDEX `repair_orders_status_follow_up_on_index` ON `repair_orders`(`status`, `follow_up_on`);

-- แจ้งเตือนชนิดใหม่ kind repair_order → subject_ref อ่าน repair_order_id ด้วย (ปิดแจ้งเตือนเมื่อรับคืน / ยกเลิก)
ALTER TABLE `notifications`
    MODIFY COLUMN `subject_ref` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_as_ci
        GENERATED ALWAYS AS (IF(JSON_VALID(`data`), COALESCE(
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.ticket_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.leave_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.vehicle_booking_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.loan_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.vpn_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.zoom_booking_id')),
            JSON_UNQUOTE(JSON_EXTRACT(`data`, '$.repair_order_id'))), NULL)) STORED;
