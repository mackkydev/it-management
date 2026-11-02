-- ประเภทของ License ซอฟต์แวร์ (Office / OS / Anti Virus / อื่นๆ) — ตรงกับช่องซอฟต์แวร์ในฟอร์มคอมพิวเตอร์
ALTER TABLE `asset_licenses` ADD COLUMN `software_type` VARCHAR(20) NOT NULL DEFAULT 'other';

-- ค่าตั้งต้นของ license เดิม: ช่องที่ติดตั้งอยู่บ่อยสุด → เดาจากชื่อ → อื่นๆ
UPDATE `asset_licenses` li
   JOIN `assets` a ON a.`id` = li.`asset_id`
   SET li.`software_type` = COALESCE(
     (SELECT i.`slot` FROM `license_installations` i
       WHERE i.`license_asset_id` = li.`asset_id` AND i.`slot` IN ('os', 'office', 'antivirus')
       GROUP BY i.`slot` ORDER BY COUNT(*) DESC LIMIT 1),
     CASE
       WHEN a.`name` LIKE '%office%' OR a.`name` LIKE '%365%' THEN 'office'
       WHEN a.`name` LIKE '%windows%' OR a.`name` LIKE '%macos%' OR a.`name` LIKE '%linux%' OR a.`name` LIKE '%ubuntu%' THEN 'os'
       WHEN a.`name` LIKE '%anti%' OR a.`name` LIKE '%defender%' OR a.`name` LIKE '%kaspersky%' OR a.`name` LIKE '%eset%'
         OR a.`name` LIKE '%norton%' OR a.`name` LIKE '%trend%' OR a.`name` LIKE '%bitdefender%' OR a.`name` LIKE '%sophos%' THEN 'antivirus'
       ELSE 'other'
     END
   );

-- สเปคคอมพิวเตอร์ (ข้อความ — ตัวเลือกจากข้อมูล Drop Down list computer_spec)
ALTER TABLE `assets` ADD COLUMN `computer_spec` VARCHAR(255) NULL;
