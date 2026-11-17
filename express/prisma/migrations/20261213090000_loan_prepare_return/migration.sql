-- ยืมโน้ตบุ๊ก: ผู้ยืมขอโดยไม่เลือกเครื่อง → เจ้าหน้าที่ IT เลือกเครื่อง + อุปกรณ์เสริม + รูป ตอนส่งมอบ
--   ผู้ยืมกดคืน (return_requested) → เจ้าหน้าที่ IT ตรวจอุปกรณ์เสริมครบแล้วยืนยันรับคืน — routes/loans.ts
-- asset_id: NOT NULL → NULL (ผ่อนเงื่อนไข ข้อมูลเดิมไม่เปลี่ยน)

ALTER TABLE `equipment_loans` MODIFY `asset_id` BIGINT NULL;

ALTER TABLE `equipment_loans`
    ADD COLUMN `accessories` JSON NULL,
    ADD COLUMN `returned_accessories` JSON NULL,
    ADD COLUMN `photos` JSON NULL,
    ADD COLUMN `return_requested_at` DATETIME(0) NULL;
