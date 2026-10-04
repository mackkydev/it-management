<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * 5.1 สาขา — ทุกคนดูรายการได้ (ใช้ในฟอร์มแจ้งงาน), เพิ่ม/แก้ไข/ลบ เฉพาะ admin
 * GET /branches?include_inactive=1 (admin) = รวมสาขาที่ปิดใช้งาน + จำนวนผู้ใช้/ใบแจ้งงาน
 */
class BranchController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $manage = $request->boolean('include_inactive') && $request->user()->isAdmin();

        $branches = Branch::query()
            ->when(! $manage, fn ($q) => $q->where('is_active', true))
            ->when($manage, fn ($q) => $q->withCount(['users', 'tickets']))
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $branches->map(fn (Branch $b) => $this->toArray($b))]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('admin');
        $branch = Branch::create($this->validated($request));

        return response()->json(['data' => $this->toArray($branch->refresh())], 201);
    }

    public function update(Request $request, Branch $branch): JsonResponse
    {
        Gate::authorize('admin');
        $branch->update($this->validated($request, $branch));

        return response()->json(['data' => $this->toArray($branch)]);
    }

    /** ลบได้เฉพาะสาขาที่ไม่มีผู้ใช้และใบแจ้งงาน — มิฉะนั้นให้ปิดใช้งานแทน */
    public function destroy(Branch $branch): Response
    {
        Gate::authorize('admin');
        if ($branch->users()->exists() || $branch->tickets()->exists()) {
            throw ValidationException::withMessages(['branch' => __('eam.branch.in_use')]);
        }
        $branch->delete();

        return response()->noContent();
    }

    private function validated(Request $request, ?Branch $branch = null): array
    {
        $s = $branch ? ['sometimes'] : [];

        return $request->validate([
            'code' => [...$s, 'required', 'string', 'max:30', 'regex:/^[A-Za-z0-9\-_]+$/', Rule::unique('branches', 'code')->ignore($branch)],
            'name' => [...$s, 'required', 'string', 'max:255'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:9999'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }

    private function toArray(Branch $b): array
    {
        return array_filter([
            'id' => $b->id,
            'code' => $b->code,
            'name' => $b->name,
            'sort_order' => $b->sort_order,
            'is_active' => $b->is_active,
            'users_count' => $b->users_count ?? null,
            'tickets_count' => $b->tickets_count ?? null,
        ], fn ($v) => $v !== null);
    }
}
