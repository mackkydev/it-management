-- ย้อนกลับ 20261110090000_ticket_approver_signature (รันด้วยมือ แล้วลบแถวใน _prisma_migrations) — ไฟล์ลายเซ็นที่คัดลอกไว้ยังอยู่ใน storage
ALTER TABLE `it_tickets` DROP COLUMN `approver_signature`;
