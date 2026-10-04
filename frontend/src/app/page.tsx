import { redirect } from "next/navigation";
import { has, getCurrentUser } from "@/lib/auth";

/** หน้าแรก: ฝ่าย IT → คิวงาน IT, ผู้ใช้แผนกอื่น → ใบแจ้งงานของฉัน */
export default async function Home() {
  redirect(has(await getCurrentUser(), "it_tickets.queue") ? "/it/tickets" : "/tickets");
}
