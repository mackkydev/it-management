import { redirect } from "next/navigation";

/** เมนูเดิม — หมวดหมู่สัญญา ย้ายไปเป็นแท็บในหน้า "ข้อมูล Drop Down" (/dropdowns) แล้ว */
export default function Page() {
  redirect("/dropdowns?tab=contract_categories");
}
