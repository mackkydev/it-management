import "server-only";

import { getI18n } from "@/i18n/server";
import type { MessageKey } from "@/i18n/types";
import { ApiError } from "@/lib/api";

export interface ActionResult<F extends string = string> {
  ok?: boolean;
  errors?: Partial<Record<F, string>>;
  message?: string;
}

/**
 * แปลง error จาก Laravel เป็นผลลัพธ์ที่ฟอร์มแสดงได้ (ข้อความ validation จาก API แปลตามภาษาแล้ว)
 * error อื่นที่ไม่ใช่ ApiError (เช่น redirect ของ Next.js) จะถูกโยนต่อ
 */
export async function toActionResult<F extends string>(e: unknown, notFound: MessageKey = "common.saveFailed"): Promise<ActionResult<F>> {
  if (!(e instanceof ApiError)) throw e;
  const { t } = await getI18n();

  if (e.status === 422 && e.body.errors) {
    const errors: Partial<Record<F, string>> = {};
    for (const [field, messages] of Object.entries(e.body.errors)) {
      errors[field as F] = messages[0];
    }
    return { errors, message: t("common.checkInput") };
  }
  if (e.status === 403) return { message: t("common.noPermission") };
  if (e.status === 404) return { message: t(notFound) };
  if (e.status === 429) return { message: t("common.tooManyRequests") };
  return { message: t("common.saveFailed") };
}
