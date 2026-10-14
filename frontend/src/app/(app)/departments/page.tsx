import { redirect } from "next/navigation";

/** เมนูเดิม — รวมเป็นหน้า "ฝ่ายและแผนก" (/org-units) แล้ว พาไปแท็บที่ตรงกัน */
export default function Page() {
  redirect("/org-units?tab=departments");
}
