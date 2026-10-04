"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import {
  changePassword, deleteSignature, updateProfile, uploadSignature,
  type PasswordResult, type ProfileResult, type SignatureResult,
} from "@/app/actions/profile";
import { AlertIcon, CheckCircleIcon, PenIcon, SaveIcon, SpinnerIcon, TrashIcon, UploadIcon, XIcon } from "@/components/icons";
import { SignaturePad } from "@/components/signature-pad";
import { alert, btn, card, input, inputError } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import type { User } from "@/lib/types";

function Feedback({ result }: { result: { ok?: boolean; message?: string } }) {
  if (!result.message) return null;
  return result.ok ? (
    <p role="status" className={alert.success}>
      <CheckCircleIcon className="shrink-0 text-success-500" />
      {result.message}
    </p>
  ) : (
    <p role="alert" className={alert.error}>
      <AlertIcon className="shrink-0 text-danger-400" />
      {result.message}
    </p>
  );
}

/** ช่องกรอกพร้อม error ใต้ช่อง — error หายทันทีเมื่อผู้ใช้แก้ช่องนั้น */
function Field({
  name,
  label,
  error,
  ...props
}: { name: string; label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [touched, setTouched] = useState(false);
  const showError = error && !touched;
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <input
        id={name}
        name={name}
        onChange={() => setTouched(true)}
        className={`${input} ${showError ? inputError : ""}`}
        {...props}
      />
      {showError && <p className="mt-1 text-xs font-medium text-red-500">{error}</p>}
    </div>
  );
}

function SubmitBtn({ pending, label }: { pending: boolean; label: string }) {
  const { t } = useI18n();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={btn.primary}>
      {pending ? <SpinnerIcon /> : <SaveIcon />}
      {pending ? t("common.saving") : label}
    </button>
  );
}

export function ProfileForm({ user }: { user: User }) {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<ProfileResult, FormData>(updateProfile, {});

  return (
    <form action={action} className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <h2 className="font-semibold">{t("profile.info")}</h2>
      <Feedback result={state} />
      {/* key: รีเซ็ตสถานะ "แก้แล้ว" ของช่องเมื่อได้ผลลัพธ์ใหม่จาก server */}
      <div key={JSON.stringify(state)} className="grid gap-4 sm:grid-cols-2">
        <Field name="name" label={t("profile.name")} defaultValue={user.name} required maxLength={255} autoComplete="name" error={state.errors?.name} />
        <Field name="email" label={t("profile.email")} type="email" defaultValue={user.email} required maxLength={255} autoComplete="email" error={state.errors?.email} />
      </div>
      <p className="text-sm text-muted">
        {t("profile.role")}: <span className="font-medium text-ink">{t(`roles.${user.role}`)}</span>
      </p>
      <SubmitBtn pending={pending} label={t("profile.saveInfo")} />
    </form>
  );
}

const SIGNATURE_MAX_BYTES = 1024 * 1024; // ตรงกับ API max:1024 (KB)
const SIGNATURE_TYPES = ["image/png", "image/jpeg"];

/**
 * ลายเซ็นในโปรไฟล์ — แสตมป์ลงช่อง "ผู้แจ้งดำเนินงาน" ของใบแจ้งงานตอนดู/พิมพ์
 * ไม่ย่อรูปอัตโนมัติ (การแปลงเป็น JPEG ทำให้พื้นโปร่งใสของ PNG หายไป) — ตรวจขนาดแทน
 */
/**
 * ลายเซ็นของฉัน — แท็บ "อัปโหลด" (PNG/JPG ≤ 1MB) กับ "วาดลายเซ็น" (เมาส์/สัมผัส → PNG พื้นโปร่งใส)
 * พรีวิวก่อนบันทึก; API crop ขอบ + ย่อ + re-encode PNG แล้วเก็บเข้ารหัส — ลายเซ็นเดิมเก็บเป็นประวัติ
 */
export function SignatureCard({ url }: { url: string | null }) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"upload" | "draw">("upload");
  const [result, setResult] = useState<SignatureResult>({});
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"save" | "remove" | null>(null);
  const [picked, setPicked] = useState<{ file: File; preview: string } | null>(null);
  const [drawn, setDrawn] = useState<string | null>(null);
  const [padKey, setPadKey] = useState(0);
  const error = result.errors?.signature;

  const clearPicked = () => {
    if (picked) URL.revokeObjectURL(picked.preview);
    setPicked(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onPick = (file: File | undefined) => {
    setResult({});
    if (!file) return;
    // ตรวจเบื้องต้นฝั่ง browser — API ตรวจจากเนื้อไฟล์อีกชั้น
    if (!SIGNATURE_TYPES.includes(file.type)) return setResult({ errors: { signature: t("profile.signatureType") } });
    if (file.size > SIGNATURE_MAX_BYTES) return setResult({ errors: { signature: t("profile.signatureTooLarge") } });
    clearPicked();
    setPicked({ file, preview: URL.createObjectURL(file) });
  };

  const send = (file: File, source: "UPLOAD" | "DRAW") => {
    const fd = new FormData();
    fd.set("signature", file);
    fd.set("source", source);
    setAction("save");
    start(async () => {
      const res = await uploadSignature(fd);
      setResult(res);
      if (!res.errors) {
        clearPicked();
        setDrawn(null);
        setPadKey((k) => k + 1);
      }
    });
  };

  const save = async () => {
    if (tab === "upload") {
      if (!picked) return setResult({ errors: { signature: t("profile.signatureType") } });
      return send(picked.file, "UPLOAD");
    }
    if (!drawn) return setResult({ errors: { signature: t("signature.required") } });
    const blob = await (await fetch(drawn)).blob();
    send(new File([blob], "signature.png", { type: "image/png" }), "DRAW");
  };

  const clear = () => {
    setResult({});
    if (tab === "upload") clearPicked();
    else {
      setDrawn(null);
      setPadKey((k) => k + 1);
    }
  };

  const onRemove = () => {
    if (!confirm(t("profile.signatureConfirmRemove"))) return;
    setAction("remove");
    start(async () => setResult(await deleteSignature()));
  };

  const tabCls = (active: boolean) =>
    `flex-1 cursor-pointer rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-surface text-ink shadow-sm ring-1 ring-line" : "text-muted hover:text-ink"}`;
  const hasDraft = tab === "upload" ? Boolean(picked) : Boolean(drawn);

  return (
    <section className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="font-semibold">{t("profile.signatureTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("profile.signatureHint")}</p>
      </div>
      {result.message && !error && <Feedback result={result} />}

      {/* ลายเซ็นปัจจุบัน */}
      <div>
        <p className="mb-1 text-xs font-medium text-muted">{t("profile.signatureCurrent")}</p>
        <div className="flex h-24 items-center justify-center rounded-xl bg-subtle p-3 ring-1 ring-line">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element -- ไฟล์ส่วนตัวผ่าน route handler /files
            <img src={`/files${url}`} alt={t("profile.signatureTitle")} className="max-h-full max-w-full object-contain dark:invert" />
          ) : (
            <span className="text-sm text-faint">{t("profile.signatureNone")}</span>
          )}
        </div>
      </div>

      <div role="tablist" className="flex gap-1 rounded-xl bg-subtle p-1">
        <button type="button" role="tab" aria-selected={tab === "upload"} onClick={() => (setTab("upload"), setResult({}))} className={tabCls(tab === "upload")}>
          <UploadIcon width={15} height={15} className="mr-1 inline" />
          {t("profile.signatureTabUpload")}
        </button>
        <button type="button" role="tab" aria-selected={tab === "draw"} onClick={() => (setTab("draw"), setResult({}))} className={tabCls(tab === "draw")}>
          <PenIcon width={15} height={15} className="mr-1 inline" />
          {t("profile.signatureDraw")}
        </button>
      </div>

      {tab === "upload" ? (
        <div>
          <input ref={inputRef} type="file" accept={SIGNATURE_TYPES.join(",")} className="hidden" onChange={(e) => onPick(e.target.files?.[0])} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={`flex h-32 w-full cursor-pointer items-center justify-center rounded-xl border-2 border-dashed bg-subtle p-3 transition-colors hover:bg-surface ${error ? inputError : "border-line"}`}
          >
            {picked ? (
              // eslint-disable-next-line @next/next/no-img-element -- พรีวิวไฟล์ที่เลือก (object URL)
              <img src={picked.preview} alt={t("profile.signaturePreview")} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="flex items-center gap-2 text-sm text-muted">
                <UploadIcon />
                {t("profile.signatureChoose")}
              </span>
            )}
          </button>
        </div>
      ) : (
        // วาดลายเซ็น — หมึกเข้มบนพื้นขาว บันทึกเป็น PNG พื้นโปร่งใส
        <SignaturePad key={padKey} onChange={(d) => (setDrawn(d), setResult({}))} invalid={Boolean(error)} />
      )}
      {error && <p className="text-xs font-medium text-red-500">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending || !hasDraft} onClick={save} aria-busy={pending} className={`${btn.primary} disabled:cursor-not-allowed disabled:opacity-60`}>
          {pending && action === "save" ? <SpinnerIcon /> : <SaveIcon />}
          {t("profile.signatureSave")}
        </button>
        {tab === "upload" && (
          <button type="button" disabled={pending || !hasDraft} onClick={clear} className={`${btn.secondary} disabled:cursor-not-allowed disabled:opacity-60`}>
            <XIcon className="text-faint" />
            {t("profile.signatureClear")}
          </button>
        )}
        {url && (
          <button type="button" disabled={pending} onClick={onRemove} className={`${btn.danger} ml-auto`}>
            {pending && action === "remove" ? <SpinnerIcon /> : <TrashIcon />}
            {t("profile.signatureRemove")}
          </button>
        )}
      </div>
    </section>
  );
}

export function PasswordForm() {
  const { t } = useI18n();
  const [state, action, pending] = useActionState<PasswordResult, FormData>(changePassword, {});

  return (
    <form action={action} className={`space-y-4 p-4 sm:p-6 ${card}`}>
      <div>
        <h2 className="font-semibold">{t("profile.passwordTitle")}</h2>
        <p className="mt-1 text-sm text-muted">{t("profile.passwordHint")}</p>
      </div>
      <Feedback result={state} />
      <div key={JSON.stringify(state)} className="grid gap-4 sm:grid-cols-3">
        <Field name="current_password" label={t("profile.currentPassword")} type="password" required autoComplete="current-password" error={state.errors?.current_password} />
        <Field name="password" label={t("profile.newPassword")} type="password" required minLength={8} autoComplete="new-password" error={state.errors?.password} />
        <Field name="password_confirmation" label={t("profile.confirmPassword")} type="password" required autoComplete="new-password" error={state.errors?.password_confirmation} />
      </div>
      <SubmitBtn pending={pending} label={t("profile.changePassword")} />
    </form>
  );
}
