-- ย้อนกลับ: คำขอที่ยังไม่ได้เลือกเครื่อง (asset_id IS NULL) ต้องยกเลิก/ลบก่อน ไม่งั้น MODIFY NOT NULL ไม่ผ่าน
--   รายการที่รอยืนยันคืน (status = 'return_requested') กลับเป็น on_loan
UPDATE `equipment_loans` SET `status` = 'on_loan' WHERE `status` = 'return_requested';
ALTER TABLE `equipment_loans`
    DROP COLUMN `accessories`,
    DROP COLUMN `returned_accessories`,
    DROP COLUMN `photos`,
    DROP COLUMN `return_requested_at`;
ALTER TABLE `equipment_loans` MODIFY `asset_id` BIGINT NOT NULL;
DELETE FROM `_prisma_migrations` WHERE `migration_name` = '20261213090000_loan_prepare_return';
