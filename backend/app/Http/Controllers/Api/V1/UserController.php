<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\UserRole;
use App\Http\Controllers\Controller;
use App\Http\Requests\User\UserRequest;
use App\Http\Resources\UserOptionResource;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    /** สังกัด + สายบังคับบัญชา + สิทธิ์ฝ่าย IT (ไม่อยู่ใน $fillable — admin กำหนดผ่าน forceFill) */
    private const ORG_FIELDS = ['branch_id', 'department', 'division', 'supervisor_id', 'is_it_staff', 'is_it_head'];

    private const ORG_RELATIONS = ['branch:id,name', 'supervisor:id,name'];

    /**
     * GET /api/v1/users?search=&per_page=20
     *   รายชื่อผู้ใช้ที่ยังใช้งานอยู่ สำหรับเลือกเป็นผู้ถือครอง (admin/manager) — simplePaginate ไม่นับ total
     * GET /api/v1/users?manage=1&search=&role=&status=active|inactive&page=
     *   หน้าจัดการผู้ใช้ (admin) — รวมบัญชีที่ปิดใช้งาน พร้อม role และจำนวนสินทรัพย์ที่ถือครอง
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        if ($request->boolean('manage')) {
            return $this->manageIndex($request);
        }

        Gate::authorize('viewAny', User::class);

        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);

        $users = $this->searchQuery($filters['search'] ?? null)
            ->where('is_active', true)
            ->orderBy('name')
            ->orderBy('id')
            ->simplePaginate($filters['per_page'] ?? 20, ['id', 'name', 'email'])
            ->withQueryString();

        return UserOptionResource::collection($users);
    }

    private function manageIndex(Request $request): AnonymousResourceCollection
    {
        Gate::authorize('manage', User::class);

        $f = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'role' => ['nullable', Rule::enum(UserRole::class)],
            'status' => ['nullable', 'in:active,inactive'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $users = $this->searchQuery($f['search'] ?? null)
            ->when($f['role'] ?? null, fn ($q, $role) => $q->where('role', $role))
            ->when($f['status'] ?? null, fn ($q, $s) => $q->where('is_active', $s === 'active'))
            ->with(self::ORG_RELATIONS)
            ->withCount('custodianAssets')
            ->orderBy('name')
            ->orderBy('id')
            ->paginate($f['per_page'] ?? 25)
            ->withQueryString();

        return UserResource::collection($users);
    }

    private function searchQuery(?string $term)
    {
        $term = trim((string) $term);
        $escaped = addcslashes($term, '%_\\');

        return User::query()->when($term !== '', fn ($q) => $q->where(fn ($q) => $q
            ->whereLike('name', '%'.$escaped.'%')
            ->orWhereLike('email', $escaped.'%')));
    }

    public function show(User $user): UserResource
    {
        Gate::authorize('view', $user);

        return UserResource::make($user->load(self::ORG_RELATIONS)->loadCount('custodianAssets'))->additional([
            'meta' => ['can_delete' => ! $user->hasHistory()],
        ]);
    }

    public function store(UserRequest $request): UserResource
    {
        Gate::authorize('create', User::class);

        $user = new User;
        // role / is_active ไม่อยู่ใน $fillable (กันยกระดับสิทธิ์) จึงกำหนดผ่าน forceFill เฉพาะที่ admin เท่านั้น
        $user->forceFill([
            'name' => $request->validated('name'),
            'email' => strtolower($request->validated('email')),
            'role' => $request->validated('role'),
            'is_active' => $request->boolean('is_active', true),
            'password' => $request->validated('password'),
            ...collect($request->validated())->only(self::ORG_FIELDS)->all(),
        ])->save();

        return UserResource::make($user->refresh()->load(self::ORG_RELATIONS)->loadCount('custodianAssets'));
    }

    /** ปิดใช้งาน หรือรีเซ็ตรหัสผ่าน → เพิกถอน token ทุกอุปกรณ์ของผู้ใช้นั้นทันที */
    public function update(UserRequest $request, User $user): UserResource
    {
        Gate::authorize('update', $user);

        DB::transaction(function () use ($request, $user) {
            $data = collect($request->validated())->only(['name', 'email', 'role', 'is_active', ...self::ORG_FIELDS])->all();
            if (isset($data['email'])) {
                $data['email'] = strtolower($data['email']);
            }
            if ($request->filled('password')) {
                $data['password'] = $request->validated('password');
            }

            $user->forceFill($data)->save();

            if ($user->wasChanged('password') || ($user->wasChanged('is_active') && ! $user->is_active)) {
                $user->tokens()->delete();
            }
        });

        return UserResource::make($user->load(self::ORG_RELATIONS)->loadCount('custodianAssets'));
    }

    /** ลบได้เฉพาะผู้ใช้ที่ไม่มีประวัติในระบบ — ถ้ามี ให้ปิดใช้งานแทน (เก็บ audit trail) */
    public function destroy(Request $request, User $user): Response
    {
        Gate::authorize('delete', $user);

        if ($request->user()->is($user)) {
            throw ValidationException::withMessages(['user' => __('eam.user.self_delete')]);
        }
        if ($user->hasHistory()) {
            throw ValidationException::withMessages(['user' => __('eam.user.has_history')]);
        }

        DB::transaction(function () use ($user) {
            $user->tokens()->delete();
            $user->delete();
        });

        return response()->noContent();
    }
}
