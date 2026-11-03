import { licenseYears } from "@/lib/date";
import type { License, LicenseRecordValues } from "@/lib/types";

/** ค่าเริ่มต้นตอนแก้ไขจากข้อมูล API */
export function licenseToValues(l: License): LicenseRecordValues {
  return {
    license_no: l.license_no ?? "",
    name: l.name,
    brand: l.brand ?? "",
    model: l.model ?? "",
    serial_number: l.serial_number ?? "",
    status: l.status,
    location_id: l.location ? String(l.location.id) : "",
    branch_id: l.branch ? String(l.branch.id) : "",
    purchase_date: l.purchase_date ?? "",
    purchase_cost: l.purchase_cost ?? "",
    notes: l.notes ?? "",
    license: {
      billing: l.license.billing,
      start_date: l.license.start_date ?? "",
      expires_at: l.license.expires_at ?? "",
      seats: l.license.seats ? String(l.license.seats) : "",
      vendor: l.license.vendor ?? "",
      license_key: "", // ไม่ส่ง key กลับมา — เว้นว่าง = คงเดิม
      clear_license_key: false,
      notify_days_before: l.license.notify_days_before ? String(l.license.notify_days_before) : "",
      // กำหนดระยะเวลาเอง: เติมจำนวนปีถ้าช่วงวันลงตัวเป็นปีเต็ม
      duration_years: l.license.billing === "custom" ? licenseYears(l.license.start_date, l.license.expires_at ?? "") : "",
      software_type: l.license.software_type ?? "other",
    },
  };
}
