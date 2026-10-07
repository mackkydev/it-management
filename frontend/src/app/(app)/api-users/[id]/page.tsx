import { notFound, redirect } from "next/navigation";

/** ลิงก์เดิมของหน้าแก้สิทธิ์ API User → หน้าสิทธิ์การใช้งานของผู้ใช้ (ใช้ร่วมกันทั้งผู้ใช้ LOCAL และ API) */
export default async function ApiUserPermissionsRedirect({ params }: PageProps<"/api-users/[id]">) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  redirect(`/users/${id}/permissions`);
}
