import { redirect } from "next/navigation";

/** เมนู ขอใช้ VPN → ฟอร์มแจ้งงาน IT เลือก "อื่นๆ → ขอใช้งาน VPN" ไว้ให้ (ผ่านหัวหน้า → คิวงาน IT → มอบบัญชีที่ จัดการ VPN) */
export default function VpnRequestPage() {
  redirect("/tickets/new?vpn=1");
}
