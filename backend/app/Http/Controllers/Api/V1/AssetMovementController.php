<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Asset\TransferAssetRequest;
use App\Http\Resources\AssetMovementResource;
use App\Models\Asset;
use App\Services\AssetMovementService;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * ประวัติการโอนย้ายของสินทรัพย์ — มีเฉพาะดูรายการและเพิ่ม (audit log ห้ามแก้ไข/ลบ)
 */
class AssetMovementController extends Controller
{
    private const RELATIONS = [
        'fromLocation:id,code,name',
        'toLocation:id,code,name',
        'fromCustodian:id,name',
        'toCustodian:id,name',
        'performer:id,name',
    ];

    /** GET /api/v1/assets/{asset}/movements?per_page=20 — ล่าสุดก่อน */
    public function index(Request $request, Asset $asset): AnonymousResourceCollection
    {
        Gate::authorize('view', $asset);

        $perPage = $request->validate(['per_page' => ['nullable', 'integer', 'min:1', 'max:100']])['per_page'] ?? 20;

        $movements = $asset->movements()
            ->with(self::RELATIONS)
            ->orderByDesc('moved_at')
            ->orderByDesc('id')
            ->paginate($perPage)
            ->withQueryString();

        return AssetMovementResource::collection($movements);
    }

    /** POST /api/v1/assets/{asset}/movements — โอนย้ายสถานที่/ผู้ถือครอง และบันทึกประวัติในคราวเดียว */
    public function store(TransferAssetRequest $request, Asset $asset, AssetMovementService $service): AssetMovementResource
    {
        Gate::authorize('update', $asset);

        $movement = DB::transaction(function () use ($request, $asset, $service) {
            $asset = Asset::whereKey($asset->getKey())->lockForUpdate()->firstOrFail();
            $fromLocation = $asset->location_id;
            $fromCustodian = $asset->custodian_id;

            $asset->fill($request->safe()->only(['location_id', 'custodian_id']));
            $asset->updated_by = $request->user()->id;

            $movedAt = $request->filled('moved_at') ? Date::parse($request->validated('moved_at')) : null;
            $movement = $service->recordIfMoved(
                $asset, $fromLocation, $fromCustodian, $request->user(), $request->validated('reason'), $movedAt,
            );

            if (! $movement) {
                throw ValidationException::withMessages(['location_id' => __('eam.movement.no_change')]);
            }

            $asset->save();

            return $movement;
        });

        return AssetMovementResource::make($movement->load(self::RELATIONS));
    }
}
