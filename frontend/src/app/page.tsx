import { redirect } from "next/navigation";

/** หน้าแรก (หลัง login / กดโลโก้) = ภาพรวม (Dashboard) ของผู้ใช้ทุกคน */
export default function Home() {
  redirect("/dashboard");
}
