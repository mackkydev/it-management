<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\AssetStatus;
use App\Http\Controllers\Controller;
use App\Http\Requests\Asset\StoreAssetRequest;
use App\Http\Requests\Asset\UpdateAssetRequest;
use App\Http\Resources\AssetResource;
use App\Models\Asset;
use App\Services\AssetMovementService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

class AssetController extends Controller
{
    /** คอลัมน์ที่อนุญาตให้ sort ได้ (whitelist ป้องกัน SQL injection ผ่าน ORDER BY) */
    private const SORTABLE = ['asset_tag', 'name', 'category', 'status', 'purchase_date', 'created_at'];

    /**
     * GET /api/v1/assets?search=&status=&category=&location_id=&sort=-created_at&per_page=25&page=1
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Asset::class);

        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::enum(AssetStatus::class)],
            'category' => ['nullable', 'string', 'max:50'],
            'location_id' => ['nullable', 'integer'],
            'sort' => ['nullable', 'string', Rule::in(array_merge(self::SORTABLE, array_map(fn ($c) => "-$c", self::SORTABLE)))],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $sort = $filters['sort'] ?? '-created_at';
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $column = ltrim($sort, '-');

        $assets = Asset::query()
            ->with(['location:id,code,name,type,parent_id', 'custodian:id,name']) // eager load ป้องกัน N+1
            ->search($filters['search'] ?? null)
            ->when($filters['status'] ?? null, fn ($q, $v) => $q->where('status', $v))
            ->when($filters['category'] ?? null, fn ($q, $v) => $q->where('category', $v))
            ->when($filters['location_id'] ?? null, fn ($q, $v) => $q->where('location_id', $v))
            ->orderBy($column, $direction)
            ->orderBy('id', $direction) // ลำดับคงที่เมื่อค่าที่ sort ซ้ำกัน
            ->paginate($filters['per_page'] ?? 25)
            ->withQueryString();

        return AssetResource::collection($assets);
    }

    public function store(StoreAssetRequest $request, AssetMovementService $movements): AssetResource
    {
        Gate::authorize('create', Asset::class);

        $asset = DB::transaction(function () use ($request, $movements) {
            $asset = new Asset($request->validated());
            $asset->created_by = $request->user()->id;
            $asset->updated_by = $request->user()->id;
            $asset->save();

            $movements->recordRegistration($asset, $request->user());

            return $asset;
        });

        return AssetResource::make($asset->load(['location', 'custodian']));
    }

    public function show(Asset $asset): AssetResource
    {
        Gate::authorize('view', $asset);

        return AssetResource::make($asset->load(['location', 'custodian']));
    }

    /** ถ้าสถานที่/ผู้ถือครองเปลี่ยน จะบันทึกประวัติการโอนย้ายให้อัตโนมัติ (movement_reason = เหตุผล) */
    public function update(UpdateAssetRequest $request, Asset $asset, AssetMovementService $movements): AssetResource
    {
        Gate::authorize('update', $asset);

        $asset = DB::transaction(function () use ($request, $asset, $movements) {
            // ล็อกแถวกันการแก้ไขพร้อมกัน ไม่ให้ค่า "จาก" ในประวัติคลาดเคลื่อน
            $asset = Asset::whereKey($asset->getKey())->lockForUpdate()->firstOrFail();
            $fromLocation = $asset->location_id;
            $fromCustodian = $asset->custodian_id;

            $asset->fill($request->safe()->except('movement_reason'));
            $asset->updated_by = $request->user()->id;
            $asset->save();

            $movements->recordIfMoved($asset, $fromLocation, $fromCustodian, $request->user(), $request->validated('movement_reason'));

            return $asset;
        });

        return AssetResource::make($asset->load(['location', 'custodian']));
    }

    /** Soft delete — เก็บประวัติไว้เพื่อการตรวจสอบ (audit) */
    public function destroy(Asset $asset): Response
    {
        Gate::authorize('delete', $asset);

        $asset->delete();

        return response()->noContent();
    }
}
