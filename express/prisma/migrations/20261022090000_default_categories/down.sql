-- ลบเฉพาะค่าตั้งต้นที่ยังไม่มีข้อมูลใช้
DELETE c FROM `contract_categories` c WHERE c.name IN ('ระบบงาน','เซิร์ฟเวอร์','เครือข่าย','อีเมล','ซอฟต์แวร์/License','Cloud','คอมพิวเตอร์','Hosting','Hostname','อื่นๆ') AND NOT EXISTS (SELECT 1 FROM `contracts` x WHERE x.category_id = c.id);
DELETE FROM `dropdown_options` WHERE `list` = 'vault_category' AND `name` IN ('คอมพิวเตอร์','Hosting','Hostname') AND NOT EXISTS (SELECT 1 FROM `credentials` x WHERE x.category = `dropdown_options`.`name`);
