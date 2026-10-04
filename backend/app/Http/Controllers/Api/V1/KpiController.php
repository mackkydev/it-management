<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\KpiEntry;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * บันทึกการปฏิบัติงาน (KPI) — ตรงกับ express/src/routes/kpi.ts
 *   GET    /kpi?user_id=&from=&to=&per_page=   ของตัวเอง (admin / หัวหน้า IT ดูของผู้อื่นได้)
 *   POST   /kpi             { work_date, details }
 *   PATCH  /kpi/{id}        เจ้าของหรือ admin
 *   DELETE /kpi/{id}        เจ้าของหรือ admin
 */
class KpiController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $u = $request->user();
        $f = $request->validate([
            'user_id' => ['nullable', 'integer'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $userId = isset($f['user_id']) ? (int) $f['user_id'] : null;
        abort_unless($userId === null || $userId === $u->id || $this->canViewOthers($u), 403);

        $page = KpiEntry::query()
            ->with('user:id,name')
            ->when($userId !== null, fn ($q) => $q->where('user_id', $userId))
            ->when($userId === null && ! $this->canViewOthers($u), fn ($q) => $q->where('user_id', $u->id))
            ->when($f['from'] ?? null, fn ($q, $d) => $q->whereDate('work_date', '>=', $d))
            ->when($f['to'] ?? null, fn ($q, $d) => $q->whereDate('work_date', '<=', $d))
            ->orderByDesc('work_date')
            ->orderByDesc('id')
            ->paginate($f['per_page'] ?? 20);

        return response()->json([
            'data' => $page->getCollection()->map(fn (KpiEntry $k) => $this->toArray($k, $u)),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(), 'from' => $page->firstItem(), 'to' => $page->lastItem()],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->rules(false), $this->messages());
        $entry = new KpiEntry($data);
        $entry->user_id = $request->user()->id;
        $entry->save();

        return response()->json(['data' => $this->toArray($entry->load('user:id,name'), $request->user())], 201);
    }

    public function update(Request $request, KpiEntry $kpi): JsonResponse
    {
        abort_unless($this->canEdit($request->user(), $kpi), 403);
        $kpi->update($request->validate($this->rules(true), $this->messages()));

        return response()->json(['data' => $this->toArray($kpi->load('user:id,name'), $request->user())]);
    }

    public function destroy(Request $request, KpiEntry $kpi): Response
    {
        abort_unless($this->canEdit($request->user(), $kpi), 403);
        $kpi->delete();

        return response()->noContent();
    }

    /** ดูบันทึกของผู้อื่นได้: admin และหัวหน้า IT */
    private function canViewOthers(User $u): bool
    {
        return $u->isAdmin() || (bool) $u->is_it_head;
    }

    private function canEdit(User $u, KpiEntry $k): bool
    {
        return $k->user_id === $u->id || $u->isAdmin();
    }

    /**
     * วันที่ปฏิบัติงานต้องไม่เป็นวันในอนาคต — "today" ของ app เป็น UTC ซึ่งช้ากว่าเวลาไทย 7 ชม.
     * จึงยอมถึง "tomorrow" (UTC) เพื่อไม่ให้ผู้ใช้ในไทยบันทึกวันนี้ไม่ได้ช่วง 00:00–07:00
     */
    private function rules(bool $partial): array
    {
        $s = $partial ? ['sometimes'] : [];

        return [
            'work_date' => [...$s, 'required', 'date', 'before_or_equal:tomorrow'],
            'details' => [...$s, 'required', 'string', 'max:5000'],
        ];
    }

    private function messages(): array
    {
        return ['work_date.before_or_equal' => __('eam.kpi.future_date')];
    }

    private function toArray(KpiEntry $k, User $viewer): array
    {
        return [
            'id' => $k->id,
            'work_date' => $k->work_date->toDateString(),
            'details' => $k->details,
            'user' => ['id' => $k->user_id, 'name' => $k->user?->name],
            'can_edit' => $this->canEdit($viewer, $k),
            'created_at' => $k->created_at?->toIso8601String(),
            'updated_at' => $k->updated_at?->toIso8601String(),
        ];
    }
}
