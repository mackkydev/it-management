import { statusStyle } from "@/components/ui";

/** ป้ายสถานะสินทรัพย์ (ข้อความแปลแล้วจาก API หรือ dictionary) */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  const [badge, dot] = statusStyle[status] ?? statusStyle.disposed;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label}
    </span>
  );
}
