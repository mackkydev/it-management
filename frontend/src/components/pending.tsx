"use client";

import { useLinkStatus } from "next/link";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { SpinnerIcon } from "@/components/icons";

/**
 * ปุ่ม submit ที่แสดงวงหมุนระหว่างฟอร์มกำลังทำงาน (ใช้กับ <form>/<Form> ที่ไม่ได้คุม pending เอง)
 * ใช้ useFormStatus จึงต้องอยู่ภายในฟอร์มนั้น
 */
export function SubmitButton({
  icon,
  children,
  pendingText,
  className,
  ...rest
}: {
  icon?: ReactNode;
  children: ReactNode;
  pendingText?: string;
  className: string;
  "aria-label"?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={className} {...rest}>
      {pending ? <SpinnerIcon /> : icon}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** ใส่ไว้ใน <Link> เพื่อสลับ icon เป็นวงหมุนระหว่างรอเปลี่ยนหน้า */
export function LinkPendingIcon({ icon, size = 16 }: { icon: ReactNode; size?: number }) {
  const { pending } = useLinkStatus();
  return pending ? <SpinnerIcon width={size} height={size} /> : <>{icon}</>;
}
