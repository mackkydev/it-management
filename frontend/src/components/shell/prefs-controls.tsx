"use client";

import { useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import {
  CheckIcon,
  LanguageIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  SidebarIcon,
  SunIcon,
  TopbarIcon,
} from "@/components/icons";
import { usePrefs } from "@/components/prefs-provider";
import { Tooltip } from "@/components/tooltip";
import { input as inputCls, inputError as inputErrorCls } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import { HEX_RE } from "@/lib/color";
import { CUSTOM_SUGGESTIONS, LAYOUTS, LOCALES, MODES, PRESET_THEMES, THEME_SWATCH, type Layout, type Mode } from "@/lib/prefs";

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const MODE_ICON: Record<Mode, IconType> = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };
const LAYOUT_ICON: Record<Layout, IconType> = { sidebar: SidebarIcon, topbar: TopbarIcon };

/** ปุ่มกลุ่มแบบเลือกได้ 1 ค่า */
function Segmented<T extends string>({
  label,
  icon: Icon,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  icon: IconType;
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  render: (v: T) => ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon width={13} height={13} className="text-accent-400" />
        {label}
      </div>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-subtle p-1">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            onClick={() => onChange(o)}
            className={`flex min-w-0 cursor-pointer items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-1.5 text-xs transition-colors ${
              value === o
                ? "bg-surface font-medium text-accent-700 shadow-sm ring-1 ring-line dark:text-accent-300"
                : "text-muted hover:text-ink"
            }`}
          >
            {render(o)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ปุ่มสลับโหมด สว่าง / มืด / ตามระบบ */
export function ModeSwitch() {
  const { t } = useI18n();
  const { mode, set } = usePrefs();
  return (
    <Segmented
      label={t("prefs.mode")}
      icon={MonitorIcon}
      options={MODES}
      value={mode}
      onChange={(v) => set("mode", v)}
      render={(m) => {
        const Icon = MODE_ICON[m];
        return (
          <>
            <Icon width={13} height={13} />
            <span>{t(`prefs.modes.${m}`)}</span>
          </>
        );
      }}
    />
  );
}

const SWATCH = "flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110";
const SWATCH_ON = "ring-2 ring-ink/70 ring-offset-2 ring-offset-surface";

/** ตัวเลือกธีมสี: 5 ธีมสำเร็จรูป + "กำหนดเอง" (เลือกสีได้อิสระ) */
export function ThemePicker() {
  const { t } = useI18n();
  const { theme, accent, set } = usePrefs();
  const isCustom = theme === "custom";

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted">
        <PaletteIcon width={13} height={13} className="text-accent-400" />
        {t("prefs.theme")}
      </div>
      <div role="radiogroup" aria-label={t("prefs.theme")} className="flex flex-wrap gap-2">
        {PRESET_THEMES.map((th) => (
          <Tooltip key={th} label={t(`prefs.themes.${th}`)} side="top">
            <button
              type="button"
              role="radio"
              aria-checked={theme === th}
              aria-label={t(`prefs.themes.${th}`)}
              onClick={() => set("theme", th)}
              style={{ backgroundColor: THEME_SWATCH[th] }}
              className={`${SWATCH} text-slate-800 ${theme === th ? SWATCH_ON : ""}`}
            >
              {theme === th && <CheckIcon width={13} height={13} />}
            </button>
          </Tooltip>
        ))}
        {/* กำหนดเอง: วงล้อสีรุ้ง (หรือสีที่เลือกไว้) */}
        <Tooltip label={t("prefs.themes.custom")} side="top">
          <button
            type="button"
            role="radio"
            aria-checked={isCustom}
            aria-label={t("prefs.themes.custom")}
            onClick={() => set("theme", "custom")}
            style={{
              background: isCustom
                ? accent
                : "conic-gradient(#f9a8d4, #fdba74, #fde68a, #86efac, #7dd3fc, #a5b4fc, #d8b4fe, #f9a8d4)",
            }}
            className={`${SWATCH} text-white ${isCustom ? SWATCH_ON : ""}`}
          >
            {isCustom ? <CheckIcon width={13} height={13} /> : <PlusIcon width={13} height={13} className="text-slate-700" />}
          </button>
        </Tooltip>
      </div>
      {isCustom && <CustomColor accent={accent} onChange={(hex) => set("accent", hex)} />}
    </div>
  );
}

/** แผงเลือกสีเอง: color picker + ช่องกรอก hex + สีแนะนำ — เปลี่ยนทั้งระบบแบบ realtime */
function CustomColor({ accent, onChange }: { accent: string; onChange: (hex: string) => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(accent);
  const [editing, setEditing] = useState(false);
  const shown = editing ? draft : accent; // ขณะพิมพ์แสดงค่าที่พิมพ์, นอกนั้นแสดงค่าจริง

  return (
    <div className="mt-2 space-y-2 rounded-xl bg-subtle p-2.5">
      <div className="flex items-center gap-2">
        <Tooltip label={t("prefs.customPick")} side="top">
          <label className="relative h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-lg ring-1 ring-line">
            <span className="absolute inset-0" style={{ backgroundColor: accent }} />
            <input
              type="color"
              value={accent}
              onChange={(e) => onChange(e.target.value.toLowerCase())}
              aria-label={t("prefs.customPick")}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </Tooltip>
        <input
          value={shown}
          onFocus={() => {
            setDraft(accent);
            setEditing(true);
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => {
            const v = e.target.value.trim();
            setDraft(v);
            if (HEX_RE.test(v)) onChange(v.toLowerCase());
          }}
          maxLength={7}
          spellCheck={false}
          aria-label={t("prefs.customHex")}
          className={`${inputCls} font-mono uppercase ${editing && !HEX_RE.test(draft) ? inputErrorCls : ""}`}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] text-muted">{t("prefs.customSuggest")}</span>
        {CUSTOM_SUGGESTIONS.map((hex) => (
          <Tooltip key={hex} label={<span className="font-mono">{hex.toUpperCase()}</span>} side="top">
            <button
              type="button"
              onClick={() => onChange(hex)}
              aria-label={hex}
              style={{ backgroundColor: hex }}
              className={`h-5 w-5 cursor-pointer rounded-full transition-transform hover:scale-110 ${accent === hex ? "ring-2 ring-ink/60 ring-offset-1 ring-offset-subtle" : ""}`}
            />
          </Tooltip>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted">{t("prefs.customHint")}</p>
    </div>
  );
}

export function LanguageSwitch() {
  const { t } = useI18n();
  const { locale, set } = usePrefs();
  return (
    <Segmented
      label={t("prefs.language")}
      icon={LanguageIcon}
      options={LOCALES}
      value={locale}
      onChange={(v) => set("locale", v)}
      render={(l) => <span>{t(`prefs.languages.${l}`)}</span>}
    />
  );
}

export function LayoutSwitch() {
  const { t } = useI18n();
  const { layout, set } = usePrefs();
  return (
    <Segmented
      label={t("prefs.layout")}
      icon={SidebarIcon}
      options={LAYOUTS}
      value={layout}
      onChange={(v) => set("layout", v)}
      render={(l) => {
        const Icon = LAYOUT_ICON[l];
        return (
          <>
            <Icon width={13} height={13} />
            <span>{t(`prefs.layouts.${l}`)}</span>
          </>
        );
      }}
    />
  );
}

/** ชุดตั้งค่าการแสดงผลทั้งหมด */
export function PrefsControls() {
  return (
    <div className="space-y-3">
      <ModeSwitch />
      <ThemePicker />
      <LanguageSwitch />
      <LayoutSwitch />
    </div>
  );
}
