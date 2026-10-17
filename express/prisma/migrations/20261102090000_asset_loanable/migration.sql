-- ติ๊ก "เป็นเครื่องสำหรับยืม" (ฟอร์มสินทรัพย์) → แสดงในหน้า ยืมโน้ตบุ๊ก
ALTER TABLE `assets` ADD COLUMN `is_loanable` BOOLEAN NOT NULL DEFAULT false AFTER `status`;

-- ค่าเริ่มต้นตามกติกาเดิม: สินทรัพย์ใช้งาน / เก็บในคลัง ที่ผู้ถือครองเป็นเจ้าหน้าที่ IT (IT_STAFF_WHERE ใน services/ticket-workflow.ts)
UPDATE `assets` SET `is_loanable` = true
 WHERE `deleted_at` IS NULL AND `status` IN ('active', 'in_storage')
   AND `custodian_id` IN (
     SELECT `id` FROM `users`
      WHERE `is_active` = true AND (`is_it_staff` = true OR `is_it_head` = true
        OR LOWER(TRIM(`department`)) IN ('it', 'ฝ่าย it', 'ไอที', 'ฝ่ายไอที', 'เทคโนโลยีสารสนเทศ', 'ฝ่ายเทคโนโลยีสารสนเทศ')
        OR LOWER(TRIM(`division`)) IN ('it', 'ฝ่าย it', 'ไอที', 'ฝ่ายไอที', 'เทคโนโลยีสารสนเทศ', 'ฝ่ายเทคโนโลยีสารสนเทศ'))
   );
