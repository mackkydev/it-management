import { redirect } from "next/navigation";

/** ที่อยู่เดิมของเมนูนโยบาย (ย้ายเป็นเมนูหลัก /policy) */
export default function PolicyManagePage() {
  redirect("/policy");
}
