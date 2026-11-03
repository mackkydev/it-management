import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { LoadingLabel } from "@/components/skeletons";
import { card } from "@/components/ui";
import { getI18n } from "@/i18n/server";
import { ApiError, apiFetch } from "@/lib/api";
import { assetCategoryNames } from "@/lib/asset-categories";
import { canDeleteAssets, canEditAssets, getCurrentUser } from "@/lib/auth";
import { COMPUTER_DATE_FIELDS, COMPUTER_TEXT_FIELDS, EMPTY_SOFTWARE, type Asset, type AssetFormValues, type AssetMovement, type Branch, type Location, type Paginated } from "@/lib/types";
import { AssetForm } from "../../asset-form";
import { MovementTimeline } from "../../movement-timeline";

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
    is_loanable: a.is_loanable ?? false,
    is_shared: a.is_shared ?? false,
    branch_id: a.branch ? String(a.branch.id) : "",
    ...(Object.fromEntries([...COMPUTER_TEXT_FIELDS, ...COMPUTER_DATE_FIELDS].map((k) => [k, a[k] ?? ""])) as Pick<
      AssetFormValues,
      (typeof COMPUTER_TEXT_FIELDS)[number] | (typeof COMPUTER_DATE_FIELDS)[number]
    >),
    movement_reason: "",
    software: a.software ?? EMPTY_SOFTWARE,
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

/** ฟอร์มแก้ไขสินทรัพย์ */
export async function AssetEdit({ id }: { id: string }) {
  if (!UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();
  if (!canEditAssets(user)) redirect("/assets");

  const [asset, { data: locations }, { data: branches }, { t }, computerTypes, brands, computerSpecs, categories, departments] = await Promise.all([
    getAsset(id),
    apiFetch<{ data: Location[] }>("/locations"),
    apiFetch<{ data: Branch[] }>("/branches"),
    getI18n(),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/computer_type").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/brand").then((r) => r.data.map((o) => o.name)),
    apiFetch<{ data: { name: string }[] }>("/dropdown-options/computer_spec").then((r) => r.data.map((o) => o.name)),
    assetCategoryNames(),
    apiFetch<{ data: { name: string }[] }>("/departments").then((r) => r.data.map((o) => o.name)),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold">{t("assets.editTitle")}</h1>
        <p className="font-mono text-sm text-muted">{asset.asset_tag}</p>
      </div>
      <AssetForm
        locations={locations}
        branches={branches}
        computerTypes={computerTypes}
        computerSpecs={computerSpecs}
        brands={brands}
        categories={categories}
        departments={departments}
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
