import { redirect } from "next/navigation";

/** ปฏิทินยืมย้ายไปรวมในหน้า ยืมโน้ตบุ๊ก (คอลัมน์ขวา) — ลิงก์เดิม /loans?month= ยังใช้ได้ */
export default async function LoansPage({ searchParams }: PageProps<"/loans">) {
  const { month } = await searchParams;
  redirect(typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? `/loans/book?month=${month}` : "/loans/book");
}
