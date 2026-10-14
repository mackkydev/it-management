import { redirect } from "next/navigation";

/** เมนูเดิม — ตัวเลือกเรื่อง "อื่นๆ" ย้ายไปเป็นแท็บในหน้า "ข้อมูล Drop Down" (/dropdowns) แล้ว */
export default function Page() {
  redirect("/dropdowns?tab=ticket_types");
}
