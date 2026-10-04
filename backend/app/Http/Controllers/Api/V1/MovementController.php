<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\AssetMovementResource;
use App\Models\Asset;
use App\Models\AssetMovement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

/**
 * GET /api/v1/movements — ประวัติการโอนย้ายของทุกสินทรัพย์ (รายงานรวม)
 *   ?search=เลขครุภัณฑ์ &location_id= (ต้นทางหรือปลายทาง) &type= &from=YYYY-MM-DD &to=YYYY-MM-DD &per_page=
 */
class MovementController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', Asset::class);

        $f = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'location_id' => ['nullable', 'integer'],
            'type' => ['nullable', 'in:registered,transfer'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $search = trim($f['search'] ?? '');

        $movements = AssetMovement::query()
            ->with([
                'asset' => fn ($q) => $q->withTrashed()->select(['id', 'uuid', 'asset_tag', 'name']),
                'fromLocation:id,code,name',
                'toLocation:id,code,name',
                'fromCustodian:id,name',
                'toCustodian:id,name',
                'performer:id,name',
            ])
            ->when($search !== '', fn ($q) => $q->whereHas('asset', fn ($a) => $a
                ->whereLike('asset_tag', addcslashes($search, '%_\\').'%')))
            ->when($f['location_id'] ?? null, fn ($q, $id) => $q->where(fn ($q) => $q
                ->where('to_location_id', $id)->orWhere('from_location_id', $id)))
            ->when($f['type'] ?? null, fn ($q, $type) => $q->where('type', $type))
            ->when($f['from'] ?? null, fn ($q, $d) => $q->where('moved_at', '>=', $d))
            ->when($f['to'] ?? null, fn ($q, $d) => $q->where('moved_at', '<', now()->parse($d)->addDay()))
            ->orderByDesc('moved_at')
            ->orderByDesc('id')
            ->paginate($f['per_page'] ?? 25)
            ->withQueryString();

        return AssetMovementResource::collection($movements);
    }
}
