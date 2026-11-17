/**
 * แหล่งข้อมูลหลัก (เมนู ข้อมูลหลัก) ที่ใช้เป็นตัวเลือกใน Drop Down ของฟอร์มต่างๆ
 * → ปุ่ม + ด้านหลัง Drop Down (`<MasterDataSelect>`) พาไปหน้าจัดการ (เพิ่ม/แก้ไข/ลบ) ของข้อมูลนั้น
 * `perm` = สิทธิ์ที่ใช้จัดการ (ต้องตรงกับหน้า /dropdowns `TABS` และ `visible` ของเมนูใน nav.ts)
 */
export const MASTER_DATA = {
  branches: { href: "/branches", perm: "branches.manage", label: "nav.branches" },
  divisions: { href: "/org-units", perm: "org.manage", label: "masterData.divisions" },
  departments: { href: "/org-units", perm: "org.manage", label: "masterData.departments" },
  locations: { href: "/locations", perm: "locations.manage", label: "nav.locations" },
  vendors: { href: "/vendors", perm: "vendors.manage", label: "nav.vendors" },
  contract_categories: { href: "/dropdowns?tab=contract_categories", perm: "contracts.categories", label: "dropdowns.tabs.contract_categories" },
  vault_category: { href: "/dropdowns?tab=vault_category", perm: "dropdowns.manage", label: "dropdowns.tabs.vault_category" },
  asset_category: { href: "/dropdowns?tab=asset_category", perm: "dropdowns.manage", label: "dropdowns.tabs.asset_category" },
  computer_type: { href: "/dropdowns?tab=computer_type", perm: "dropdowns.manage", label: "dropdowns.tabs.computer_type" },
  computer_spec: { href: "/dropdowns?tab=computer_spec", perm: "dropdowns.manage", label: "dropdowns.tabs.computer_spec" },
  brand: { href: "/dropdowns?tab=brand", perm: "dropdowns.manage", label: "dropdowns.tabs.brand" },
  ticket_types: { href: "/dropdowns?tab=ticket_types", perm: "dropdowns.manage", label: "dropdowns.tabs.ticket_types" },
  meeting_purpose: { href: "/dropdowns?tab=meeting_purpose", perm: "meeting.rooms", label: "dropdowns.tabs.meeting_purpose" },
  meeting_equipment: { href: "/dropdowns?tab=meeting_equipment", perm: "meeting.rooms", label: "dropdowns.tabs.meeting_equipment" },
  zoom_account: { href: "/dropdowns?tab=zoom_account", perm: "zoom.manage", label: "dropdowns.tabs.zoom_account" },
  vendor_type: { href: "/dropdowns?tab=vendor_type", perm: "vendors.manage", label: "dropdowns.tabs.vendor_type" },
  vehicle_purpose: { href: "/dropdowns?tab=vehicle_purpose", perm: "vehicle.manage", label: "dropdowns.tabs.vehicle_purpose" },
  vehicle_extra: { href: "/dropdowns?tab=vehicle_extra", perm: "vehicle.manage", label: "dropdowns.tabs.vehicle_extra" },
  vehicle_type: { href: "/dropdowns?tab=vehicle_type", perm: "vehicle.manage", label: "dropdowns.tabs.vehicle_type" },
  vehicle_fuel: { href: "/dropdowns?tab=vehicle_fuel", perm: "vehicle.manage", label: "dropdowns.tabs.vehicle_fuel" },
} as const;

export type MasterDataSource = keyof typeof MASTER_DATA;
