-- ลายเซ็นผู้อนุมัติใบแจ้งงาน (สำเนาลายเซ็นในโปรไฟล์ ณ ตอนอนุมัติขั้นสุดท้าย — แสดงในแบบฟอร์มพิมพ์ ช่องผู้อนุมัติ)
ALTER TABLE `it_tickets` ADD COLUMN `approver_signature` VARCHAR(255) NULL;
