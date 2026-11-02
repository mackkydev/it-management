import { NotFoundView } from "@/components/not-found-view";

/** notFound() ในหน้าที่ login แล้ว (เช่น ใบงาน / สินทรัพย์ที่ไม่มีหรือไม่มีสิทธิ์ดู) — แสดงใน app shell */
export default function NotFound() {
  return <NotFoundView />;
}
