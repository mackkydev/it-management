-- ยืม VPN: มอบบัญชี → ผู้จัดการฝ่าย IT อนุมัติ (pending_approval) → ผู้ขอกด "ได้รับแล้ว" (ปิดใบแจ้งงาน) จึงดูรหัสได้,
--   เจ้าหน้าที่ IT เรียกคืนรหัสได้, หมดอายุแล้วแจ้งเตือนทุกวัน — services/vpn-loans.ts + routes/vpn-loans.ts

ALTER TABLE `vpn_loans`
    ADD COLUMN `approved_by` BIGINT NULL,
    ADD COLUMN `approved_at` DATETIME(0) NULL,
    ADD COLUMN `received_at` DATETIME(0) NULL,
    ADD COLUMN `revoked_at` DATETIME(0) NULL,
    ADD COLUMN `revoked_by` BIGINT NULL,
    ADD COLUMN `expired_notified_on` DATE NULL;

-- บัญชีที่มอบไปก่อนมีขั้นอนุมัติ = ถือว่าอนุมัติและได้รับแล้ว (ดูรหัสได้ตามเดิม)
UPDATE `vpn_loans` SET `approved_at` = `assigned_at`, `received_at` = `assigned_at`
 WHERE `status` IN ('active', 'renewal_requested', 'cancel_requested', 'ended') AND `assigned_at` IS NOT NULL;
