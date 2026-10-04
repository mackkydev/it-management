"use client";

import { useEffect, useRef, useState } from "react";
import { PenIcon, ResetIcon } from "@/components/icons";
import { btn } from "@/components/ui";
import { useI18n } from "@/i18n/client";

/**
 * ช่องเซ็นชื่อ (canvas) — ใช้ได้ทั้งเมาส์, ปากกา และนิ้วบนมือถือ/แท็บเล็ต
 * ส่งค่าออกเป็น data URL (PNG) ผ่าน onChange; ล้างแล้วส่ง null
 */
export function SignaturePad({
  onChange,
  invalid = false,
  height = 160,
}: {
  onChange: (dataUrl: string | null) => void;
  invalid?: boolean;
  height?: number;
}) {
  const { t } = useI18n();
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
      <button type="button" onClick={clear} disabled={empty} className={`${btn.secondary} ${btn.sm} mt-2`}>
        <ResetIcon width={13} height={13} />
        {t("signature.clear")}
      </button>
    </div>
  );
}
