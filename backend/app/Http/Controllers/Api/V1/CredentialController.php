<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\Credential;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * 4.1.1 คลังบัญชีผู้ใช้/รหัสผ่าน — เฉพาะ admin และเจ้าหน้าที่ IT (Gate "it-data")
 * - list/show ไม่ส่งรหัสผ่านกลับ (มีแค่ has_password)
 * - POST /credentials/{id}/reveal ส่งรหัสผ่านกลับ และบันทึก log ทุกครั้ง
 */
class CredentialController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('it-data');

        $f = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'category' => ['nullable', Rule::in(Credential::CATEGORIES)],
            'branch_id' => ['nullable', 'integer'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $term = addcslashes(trim($f['search'] ?? ''), '%_\\');

        $page = Credential::query()
            ->with(['branch:id,name', 'owner:id,name', 'updater:id,name'])
            ->when($term !== '', fn ($q) => $q->where(fn ($q) => $q
                ->whereLike('title', "%$term%")->orWhereLike('username', "%$term%")->orWhereLike('url', "%$term%")))
            ->when($f['category'] ?? null, fn ($q, $c) => $q->where('category', $c))
            ->when($f['branch_id'] ?? null, fn ($q, $b) => $q->where('branch_id', $b))
            ->orderBy('title')
            ->paginate($f['per_page'] ?? 25)
            ->withQueryString();

        return response()->json([
            'data' => $page->getCollection()->map(fn (Credential $c) => $this->toArray($c)),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(), 'from' => $page->firstItem(), 'to' => $page->lastItem()],
        ]);
    }

    public function show(Credential $credential): JsonResponse
    {
        Gate::authorize('it-data');

        return response()->json(['data' => $this->toArray($credential->load(['branch:id,name', 'owner:id,name', 'updater:id,name']))]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('it-data');
        $data = $this->validated($request);

        $credential = DB::transaction(function () use ($request, $data) {
            $c = new Credential($data);
            $c->created_by = $c->updated_by = $request->user()->id;
            if (! empty($data['password'])) {
                $c->password_changed_at = now();
            }
            $c->save();
            $this->log($request, $c, 'create');

            return $c;
        });

        return response()->json(['data' => $this->toArray($credential->refresh())], 201);
    }

    /** password / secret_notes: ไม่ส่งมา = คงเดิม, ส่ง "" = ลบ */
    public function update(Request $request, Credential $credential): JsonResponse
    {
        Gate::authorize('it-data');
        $data = $this->validated($request, true);

        DB::transaction(function () use ($request, $credential, $data) {
            $credential->fill($data);
            if ($credential->isDirty('password')) {
                $credential->password_changed_at = now();
            }
            $credential->updated_by = $request->user()->id;
            $credential->save();
            $this->log($request, $credential, 'update');
        });

        return response()->json(['data' => $this->toArray($credential->load(['branch:id,name', 'owner:id,name', 'updater:id,name']))]);
    }

    public function destroy(Request $request, Credential $credential): Response
    {
        Gate::authorize('it-data');
        $this->log($request, $credential, 'delete');
        $credential->delete();

        return response()->noContent();
    }

    /** เปิดดูรหัสผ่าน — บันทึก log ผู้เปิดดู + IP ทุกครั้ง */
    public function reveal(Request $request, Credential $credential): JsonResponse
    {
        Gate::authorize('it-data');
        $this->log($request, $credential, 'reveal');

        return response()->json(['data' => [
            'password' => $credential->password,
            'secret_notes' => $credential->secret_notes,
        ]]);
    }

    /** ประวัติการเข้าถึง (ล่าสุด 50 รายการ) */
    public function logs(Credential $credential): JsonResponse
    {
        Gate::authorize('it-data');
        $logs = $credential->accessLogs()->with('user:id,name')->latest('created_at')->limit(50)->get();

        return response()->json(['data' => $logs->map(fn ($l) => [
            'id' => $l->id,
            'action' => $l->action,
            'user' => $l->user ? ['id' => $l->user->id, 'name' => $l->user->name] : null,
            'ip' => $l->ip,
            'created_at' => $l->created_at->toIso8601String(),
        ])]);
    }

    private function validated(Request $request, bool $partial = false): array
    {
        $s = $partial ? ['sometimes'] : [];

        return $request->validate([
            'title' => [...$s, 'required', 'string', 'max:255'],
            'category' => [...$s, 'required', Rule::in(Credential::CATEGORIES)],
            'url' => ['sometimes', 'nullable', 'string', 'max:500'],
            'username' => ['sometimes', 'nullable', 'string', 'max:255'],
            'password' => ['sometimes', 'nullable', 'string', 'max:1000'],
            'secret_notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'branch_id' => ['sometimes', 'nullable', 'integer', Rule::exists('branches', 'id')->whereNull('deleted_at')],
            'owner_id' => ['sometimes', 'nullable', 'integer', Rule::exists('users', 'id')],
            'expires_at' => ['sometimes', 'nullable', 'date'],
        ]);
    }

    private function log(Request $request, Credential $c, string $action): void
    {
        $c->accessLogs()->create(['user_id' => $request->user()->id, 'action' => $action, 'ip' => $request->ip()]);
    }

    private function toArray(Credential $c): array
    {
        return [
            'id' => $c->id,
            'title' => $c->title,
            'category' => $c->category,
            'url' => $c->url,
            'username' => $c->username,
            'has_password' => $c->getRawOriginal('password') !== null,
            'has_secret_notes' => $c->getRawOriginal('secret_notes') !== null,
            'notes' => $c->notes,
            'branch' => $c->relationLoaded('branch') && $c->branch ? ['id' => $c->branch->id, 'name' => $c->branch->name] : null,
            'branch_id' => $c->branch_id,
            'owner' => $c->relationLoaded('owner') && $c->owner ? ['id' => $c->owner->id, 'name' => $c->owner->name] : null,
            'expires_at' => $c->expires_at?->toDateString(),
            'password_changed_at' => $c->password_changed_at?->toIso8601String(),
            'updated_by' => $c->relationLoaded('updater') && $c->updater ? $c->updater->name : null,
            'updated_at' => $c->updated_at?->toIso8601String(),
        ];
    }
}
