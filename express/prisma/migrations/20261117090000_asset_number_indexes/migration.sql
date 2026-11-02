-- ค้นสินทรัพย์จากเลขที่ผู้แจ้งพิมพ์ในใบแจ้งซ่อม: เลขที่ทรัพย์สิน (cpu_tag) / เลขที่ทรัพย์สิน (เดิม) (monitor_tag)
CREATE INDEX `assets_cpu_tag_index` ON `assets`(`cpu_tag`);
CREATE INDEX `assets_monitor_tag_index` ON `assets`(`monitor_tag`);
