import type { ComponentType, ReactNode, SVGProps } from "react";

/** หัวข้อหน้า: icon สีธีม + ชื่อหน้า + คำอธิบาย + ปุ่มด้านขวา (ถ้ามี) */
export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-100 text-accent-600 dark:bg-accent-400/15 dark:text-accent-300">
          <Icon width={22} height={22} />
        </span>
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions}
    </div>
  );
}
