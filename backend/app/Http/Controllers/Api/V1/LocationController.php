<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Location\LocationRequest;
use App\Http\Resources\LocationResource;
use App\Models\Location;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

class LocationController extends Controller
{
    public const CACHE_KEY = 'locations:active';

    /**
     * GET /api/v1/locations — สถานที่ที่ใช้งานอยู่ (ใช้ทำ dropdown/filter) cache 10 นาที
     * GET /api/v1/locations?include_inactive=1 — ทั้งหมดพร้อมจำนวนสินทรัพย์/สถานที่ย่อย (หน้าจัดการ, admin/manager)
     *
     * cache เป็น array ธรรมดา: Laravel จำกัด class ที่ unserialize จาก cache ได้ จึงไม่ cache Eloquent model
     */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', Location::class);

        if ($request->boolean('include_inactive')) {
            Gate::authorize('create', Location::class);

            $all = Location::query()
                ->withCount(['assets', 'children'])
                ->orderBy('code')
                ->get();

            return response()->json(['data' => LocationResource::collection($all)->resolve($request)]);
        }

        $locations = Cache::remember(self::CACHE_KEY, now()->addMinutes(10), fn () => LocationResource::collection(
            Location::query()
                ->where('is_active', true)
                ->orderBy('name')
                ->get(['id', 'code', 'name', 'type', 'parent_id', 'address', 'is_active'])
        )->resolve($request));

        return response()->json(['data' => $locations]);
    }

    public function show(Location $location): LocationResource
    {
        Gate::authorize('view', $location);

        return LocationResource::make($location->loadCount(['assets', 'children']));
    }

    public function store(LocationRequest $request): LocationResource
    {
        Gate::authorize('create', Location::class);

        $location = Location::create($request->validated());
        Cache::forget(self::CACHE_KEY);

        // refresh เพื่อได้ค่า default จาก DB (เช่น is_active)
        return LocationResource::make($location->refresh()->loadCount(['assets', 'children']));
    }

    public function update(LocationRequest $request, Location $location): LocationResource
    {
        Gate::authorize('update', $location);

        $location->update($request->validated());
        Cache::forget(self::CACHE_KEY);

        return LocationResource::make($location->loadCount(['assets', 'children']));
    }

    /**
     * Soft delete — ไม่อนุญาตถ้ายังมีสถานที่ย่อยหรือสินทรัพย์อยู่
     * (ให้ย้ายออกหรือปิดใช้งานแทน เพื่อไม่ให้ข้อมูลสินทรัพย์ชี้ไปยังสถานที่ที่หายไป)
     */
    public function destroy(Location $location): Response
    {
        Gate::authorize('delete', $location);

        if ($location->children()->exists()) {
            throw ValidationException::withMessages(['location' => __('eam.location.has_children')]);
        }
        if ($location->assets()->exists()) {
            throw ValidationException::withMessages(['location' => __('eam.location.has_assets')]);
        }

        $location->delete();
        Cache::forget(self::CACHE_KEY);

        return response()->noContent();
    }
}
