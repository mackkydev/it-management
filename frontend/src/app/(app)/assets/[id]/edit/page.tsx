import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingLabel } from "@/components/skeletons";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { canDeleteAssets, canManageAssets, getCurrentUser } from "@/lib/auth";
import type { Asset, AssetFormValues, AssetMovement, Location, Paginated } from "@/lib/types";
import { AssetForm } from "../../asset-form";
import { MovementTimeline } from "../../movement-timeline";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return { title: t("assets.editTitle") };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toFormValues(a: Asset): AssetFormValues {
  return {
    asset_tag: a.asset_tag,
    name: a.name,
    category: a.category,
    brand: a.brand ?? "",
    model: a.model ?? "",
    serial_number: a.serial_number ?? "",
    status: a.status,
    location_id: a.location ? String(a.location.id) : "",
    custodian_id: a.custodian ? String(a.custodian.id) : "",
    purchase_date: a.purchase_date ?? "",
    purchase_cost: a.purchase_cost ?? "",
    warranty_expires_at: a.warranty_expires_at ?? "",
    notes: a.notes ?? "",
    movement_reason: "",
  };
}

/** โหลดประวัติแยก (Suspense) เพื่อให้ฟอร์มแสดงได้ก่อน */
async function Movements({ id }: { id: string }) {
  const res = await apiFetch<Paginated<AssetMovement>>(`/assets/${id}/movements?per_page=50`);
  return <MovementTimeline movements={res.data} total={res.meta.total} />;
}

async function getAsset(id: string) {
  try {
    return (await apiFetch<{ data: Asset }>(`/assets/${id}`)).data;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
}

export default async function EditAssetPage({ params }: PageProps<"/assets/[id]/edit">) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();
  if (!canManageAssets(user)) redirect("/assets");

  const [asset, { data: locations }, { t }] = await Promise.all([
    getAsset(id),
    apiFetch<{ data: Location[] }>("/locations"),
    getI18n(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("assets.editTitle")}</h1>
        <p className="font-mono text-sm text-muted">{asset.asset_tag}</p>
      </div>
      <AssetForm
        locations={locations}
        assetId={asset.id}
        initial={toFormValues(asset)}
        initialCustodian={asset.custodian}
        canDelete={canDeleteAssets(user)}
      />
      <Suspense
        fallback={
          <section className={`p-4 sm:p-6 ${card}`}>
            <LoadingLabel text={t("movements.loading")} />
          </section>
        }
      >
        <Movements id={asset.id} />
      </Suspense>
    </div>
  );
}
