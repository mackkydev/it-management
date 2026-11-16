"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { uploadSignature } from "@/app/actions/profile";
import { CheckCircleIcon, PenIcon, ResetIcon, SaveIcon, SpinnerIcon } from "@/components/icons";
import { useToast } from "@/components/toast";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/**
 * ช่องเซ็นชื่อ (canvas) — ใช้ได้ทั้งเมาส์, ปากกา และนิ้วบนมือถือ/แท็บเล็ต
 * ส่งค่าออกเป็น data URL (PNG) ผ่าน onChange; ล้างแล้วส่ง null
 * saveToProfile = ผู้ใช้ยังไม่มีลายเซ็นในโปรไฟล์ → ปุ่ม "บันทึกเป็นลายเซ็นของฉัน" (POST /auth/me/signature source DRAW) ไว้ใช้ครั้งต่อไป
 */
export function SignaturePad({
  onChange,
  invalid = false,
  height = 160,
  saveToProfile = false,
}: {
  onChange: (dataUrl: string | null) => void;
  invalid?: boolean;
  height?: number;
  saveToProfile?: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [saved, setSaved] = useState(false);
  const [saving, startSave] = useTransition();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  // ปรับขนาด canvas ตามความกว้างจริง × devicePixelRatio ให้เส้นคมชัด
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = "#1e293b"; // หมึกสีเข้มเสมอ (ลายเซ็นบนพื้นขาว)
      setEmpty(true);
      onChange(null);
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- รีเซ็ตเฉพาะเมื่อความสูงเปลี่ยน
  }, [height]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d")!;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (!empty && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  };

  const saveMine = () => {
    const canvas = canvasRef.current;
    if (!canvas || empty) return;
    startSave(async () => {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      const fd = new FormData();
      fd.set("signature", new File([blob], "signature.png", { type: "image/png" }));
      fd.set("source", "DRAW");
      const res = await uploadSignature(fd);
      if (res.ok) {
        setSaved(true);
        toast("success", t("signature.savedMine"));
      } else toast("error", Object.values(res.errors ?? {})[0] ?? res.message ?? t("common.saveFailed"));
    });
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div
        className={`relative overflow-hidden rounded-xl bg-white ring-1 ${invalid ? "ring-red-500" : "ring-line"}`}
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          className="h-full w-full cursor-crosshair touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          aria-label={t("signature.label")}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm text-slate-400">
            <PenIcon width={16} height={16} />
            {t("signature.hint")}
          </span>
        )}
        {/* เส้นสำหรับเซ็น */}
        <span className="pointer-events-none absolute bottom-8 left-6 right-6 border-b border-dashed border-slate-300" aria-hidden="true" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={clear} disabled={empty} className={`${btn.secondary} ${btn.sm}`}>
          <ResetIcon width={13} height={13} />
          {t("signature.clear")}
        </button>
        {saveToProfile &&
          (saved ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success-700 dark:text-success-300">
              <CheckCircleIcon width={14} height={14} />
              {t("signature.savedMine")}
            </span>
          ) : (
            <>
              <button type="button" onClick={saveMine} disabled={empty || saving} aria-busy={saving} className={`${btn.soft} ${btn.sm} disabled:cursor-not-allowed`}>
                {saving ? <SpinnerIcon width={13} height={13} /> : <SaveIcon width={13} height={13} />}
                {t("signature.saveMine")}
              </button>
              <span className="text-xs text-muted">{t("signature.saveMineHint")}</span>
            </>
          ))}
      </div>
    </div>
  );
}
