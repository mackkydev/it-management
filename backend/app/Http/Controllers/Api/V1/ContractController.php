<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\AppSetting;
use App\Models\Contract;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * 4.1.2 สัญญากับ vendor — admin และเจ้าหน้าที่ IT
 * GET /contracts?status=active|expiring|expired&search=
 */
class ContractController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('it-data');

        $f = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:active,expiring,expired'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $term = addcslashes(trim($f['search'] ?? ''), '%_\\');

        $contracts = Contract::query()
            ->with('branch:id,name')
            ->when($term !== '', fn ($q) => $q->where(fn ($q) => $q
                ->whereLike('title', "%$term%")->orWhereLike('vendor_name', "%$term%")->orWhereLike('contract_no', "$term%")))
            ->orderBy('end_date')
            ->get()
            // สถานะขึ้นกับจำนวนวันแจ้งเตือนของแต่ละสัญญา จึงกรองหลังคำนวณ (จำนวนสัญญาไม่มาก)
            ->when($f['status'] ?? null, fn ($c, $s) => $c->filter(fn (Contract $x) => $x->status() === $s))
            ->values();

        $summary = ['active' => 0, 'expiring' => 0, 'expired' => 0];
        Contract::query()->get()->each(function (Contract $c) use (&$summary) {
            $summary[$c->status()]++;
        });

        return response()->json([
            'data' => $contracts->map(fn ($c) => $this->toArray($c)),
            'summary' => $summary,
            // ค่าเริ่มต้นจากหน้าตั้งค่า (เจ้าหน้าที่ IT ไม่มีสิทธิ์อ่าน /settings) ใช้แสดง hint ในฟอร์ม
            'default_notify_days' => (int) AppSetting::get('contract_notify_days'),
        ]);
    }

    public function show(Contract $contract): JsonResponse
    {
        Gate::authorize('it-data');

        return response()->json(['data' => $this->toArray($contract->load('branch:id,name'))]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('it-data');
        $contract = new Contract($this->validated($request));
        $contract->created_by = $request->user()->id;
        $contract->save();

        return response()->json(['data' => $this->toArray($contract->refresh()->load('branch:id,name'))], 201);
    }

    public function update(Request $request, Contract $contract): JsonResponse
    {
        Gate::authorize('it-data');
        $contract->update($this->validated($request, $contract));

        return response()->json(['data' => $this->toArray($contract->load('branch:id,name'))]);
    }

    public function destroy(Contract $contract): Response
    {
        Gate::authorize('it-data');
        $contract->delete();

        return response()->noContent();
    }

    private function validated(Request $request, ?Contract $contract = null): array
    {
        $s = $contract ? ['sometimes'] : [];

        return $request->validate([
            'title' => [...$s, 'required', 'string', 'max:255'],
            'vendor_name' => [...$s, 'required', 'string', 'max:255'],
            'contract_no' => ['sometimes', 'nullable', 'string', 'max:100'],
            'start_date' => [...$s, 'required', 'date'],
            'end_date' => [...$s, 'required', 'date', 'after_or_equal:start_date'],
            'amount' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:9999999999999.99'],
            'contact_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'contact_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'contact_phone' => ['sometimes', 'nullable', 'string', 'max:50'],
            'notify_days_before' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:365'],
            'notify_enabled' => ['sometimes', 'boolean'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:5000'],
            'branch_id' => ['sometimes', 'nullable', 'integer', Rule::exists('branches', 'id')->whereNull('deleted_at')],
        ]);
    }

    private function toArray(Contract $c): array
    {
        return [
            'id' => $c->id,
            'title' => $c->title,
            'vendor_name' => $c->vendor_name,
            'contract_no' => $c->contract_no,
            'start_date' => $c->start_date->toDateString(),
            'end_date' => $c->end_date->toDateString(),
            'amount' => $c->amount,
            'contact_name' => $c->contact_name,
            'contact_email' => $c->contact_email,
            'contact_phone' => $c->contact_phone,
            'notify_days_before' => $c->notify_days_before,
            'effective_notify_days' => $c->effectiveNotifyDays(),
            'notify_enabled' => $c->notify_enabled,
            'notified_at' => $c->notified_at?->toIso8601String(),
            'notes' => $c->notes,
            'branch' => $c->relationLoaded('branch') && $c->branch ? ['id' => $c->branch->id, 'name' => $c->branch->name] : null,
            'branch_id' => $c->branch_id,
            'days_left' => $c->daysLeft(),
            'status' => $c->status(),
        ];
    }
}
