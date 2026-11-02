"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeftIcon, SearchIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/** ไม่กดภายในกี่วินาทีจึงย้อนกลับอัตโนมัติ */
const AUTO_BACK_SECONDS = 5;

/**
 * หน้า 404 — ไม่พบหน้าที่ค้นหา + ปุ่มย้อนกลับ / กลับหน้าแรก — ไม่กดอะไรภายใน AUTO_BACK_SECONDS วินาที = ย้อนกลับเอง (นับถอยหลังให้เห็น)
 * ใช้ทั้ง app/not-found.tsx (ที่อยู่ไม่ตรงหน้าใดเลย) และ app/(app)/not-found.tsx (notFound() ในหน้าที่ login แล้ว — อยู่ใน app shell)
 */
export function NotFoundView() {
  const { t } = useI18n();
  const router = useRouter();
  // เปิดลิงก์ตรง (ไม่มีหน้าก่อนหน้าในแท็บนี้) = กลับหน้าแรกแทน
  const back = () => (window.history.length > 1 ? router.back() : router.push("/"));
  const [left, setLeft] = useState(AUTO_BACK_SECONDS);

  useEffect(() => {
    const timer = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (left > 0) return;
    if (window.history.length > 1) router.back();
    else router.push("/");
  }, [left, router]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-4 py-16 text-center">
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-accent-100 text-accent-700 dark:bg-accent-400/15 dark:text-accent-300">
        <SearchIcon width={28} height={28} />
      </span>
      <p className="mt-5 text-5xl font-bold tracking-tight text-accent-500 tabular-nums">404</p>
      <h1 className="mt-2 text-xl font-semibold">{t("notFound.title")}</h1>
      <p className="mt-2 text-sm text-muted">{t("notFound.hint")}</p>
      <p role="timer" className="mt-3 text-xs text-faint">
        {t("notFound.autoBack", { seconds: left })}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={back} className={btn.primary}>
          <ChevronLeftIcon width={16} height={16} />
          {t("notFound.back")}
        </button>
        <Link href="/" className={btn.secondary}>
          {t("notFound.home")}
        </Link>
      </div>
    </div>
  );
}
