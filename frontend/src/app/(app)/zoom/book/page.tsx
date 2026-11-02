import { redirect } from "next/navigation";

/** จองใช้ ZOOM = modal ในหน้ารายการจอง ZOOM — ลิงก์เดิม (ปฏิทิน / ไทม์ไลน์ ?date=&start=&end=) พาไปเปิด modal พร้อมเติมวันเวลา */
export default async function BookZoomPage({ searchParams }: PageProps<"/zoom/book">) {
  const sp = await searchParams;
  const q = new URLSearchParams({ book: "1" });
  for (const k of ["date", "start", "end"] as const) if (typeof sp[k] === "string") q.set(k, sp[k]);
  redirect(`/zoom/mine?${q}`);
}
