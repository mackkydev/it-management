<?php

namespace App\Http\Controllers\Api\V1;

use App\Enums\TicketStatus;
use App\Enums\TicketType;
use App\Http\Controllers\Controller;
use App\Http\Resources\TicketResource;
use App\Models\Asset;
use App\Models\ItTicket;
use App\Models\ItTicketAttachment;
use App\Models\ItTicketPart;
use App\Models\User;
use App\Services\TicketFiles;
use App\Services\TicketWorkflow;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * 4.2 / 4.3 ใบแจ้งดำเนินงาน IT
 *
 * GET  /tickets?scope=mine|approvals|it&status=&type=&assigned=me&search=
 * POST /tickets                        แจ้งงาน (multipart: photos[], documents[], signature)
 * GET  /tickets/{uuid}
 * POST /tickets/{uuid}/approve|reject  หัวหน้าตามสายบังคับบัญชา
 * POST /tickets/{uuid}/accept          เจ้าหน้าที่ IT รับงาน
 * POST /tickets/{uuid}/result          บันทึกผลการดำเนินงาน/การซ่อม (multipart: photos[], parts[i][photo], signature)
 * POST /tickets/{uuid}/close|return    หัวหน้า IT อนุมัติผล / ส่งกลับแก้ไข
 * GET  /tickets/{uuid}/files/{kind}/{id?}  ไฟล์แนบ/ลายเซ็น (ตรวจสิทธิ์)
 */
class TicketController extends Controller
{
    private const PHOTO_RULE = ['image', 'mimes:jpg,jpeg,png,webp', 'max:1024'];   // ≤ 1MB
    private const DOC_RULE = ['file', 'mimes:pdf,doc,docx,xls,xlsx,ppt,pptx,txt,csv,zip,jpg,jpeg,png', 'max:5120']; // ≤ 5MB

    public function __construct(private TicketWorkflow $flow, private TicketFiles $files) {}

    public function index(Request $request): JsonResponse
    {
        $u = $request->user();
        $f = $request->validate([
            'scope' => ['nullable', 'in:mine,approvals,it'],
            'status' => ['nullable', Rule::enum(TicketStatus::class)],
            'type' => ['nullable', Rule::enum(TicketType::class)],
            'assigned' => ['nullable', 'in:me'],
            'search' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $scope = $f['scope'] ?? 'mine';
        abort_if($scope === 'it' && ! $u->canAccessItData(), 403);

        $term = addcslashes(trim($f['search'] ?? ''), '%_\\');

        $page = ItTicket::query()
            ->with(['requester:id,name', 'assignee:id,name', 'branch:id,name'])
            ->when($scope === 'mine', fn ($q) => $q->where('requester_id', $u->id))
            ->when($scope === 'approvals', fn ($q) => $q->where('status', TicketStatus::PendingSupervisor)
                ->where(fn ($q) => $q->where('approver_id', $u->id)->when($u->isAdmin(), fn ($q) => $q->orWhereNull('approver_id'))))
            ->when(($f['assigned'] ?? null) === 'me', fn ($q) => $q->where('assignee_id', $u->id))
            ->when($f['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($f['type'] ?? null, fn ($q, $t) => $q->where('type', $t))
            ->when($term !== '', fn ($q) => $q->where(fn ($q) => $q
                ->whereLike('ticket_no', "%$term%")->orWhereLike('details', "%$term%")
                ->orWhereLike('asset_tag', "$term%")->orWhereLike('person_name_th', "%$term%")))
            ->latest('id')
            ->paginate($f['per_page'] ?? 20)
            ->withQueryString();

        return response()->json([
            'data' => $page->getCollection()->map(fn (ItTicket $t) => (new TicketResource($t))->summary($u, $this->flow)),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(), 'from' => $page->firstItem(), 'to' => $page->lastItem()],
            'counts' => $this->counts($u),
        ]);
    }

    /** ตัวเลขบนแท็บ/เมนู */
    private function counts(User $u): array
    {
        $counts = [
            'mine_open' => ItTicket::query()->where('requester_id', $u->id)->open()->count(),
            'approvals' => ItTicket::query()->where('status', TicketStatus::PendingSupervisor)
                ->where(fn ($q) => $q->where('approver_id', $u->id)->when($u->isAdmin(), fn ($q) => $q->orWhereNull('approver_id')))->count(),
        ];
        if ($u->canAccessItData()) {
            $counts['it_new'] = ItTicket::query()->where('status', TicketStatus::Approved)->count();
            $counts['it_in_progress'] = ItTicket::query()->where('status', TicketStatus::InProgress)->count();
            $counts['it_review'] = ItTicket::query()->where('status', TicketStatus::PendingItHead)->count();
        }

        return $counts;
    }

    /** ตัวเลือกของฟอร์มแจ้งงาน: สาขาที่เปิดใช้งาน, เจ้าหน้าที่ IT, ตัวเลือกเรื่อง "อื่นๆ" */
    public function formOptions(): JsonResponse
    {
        return response()->json(['data' => [
            'branches' => \App\Models\Branch::query()->where('is_active', true)->orderBy('sort_order')->orderBy('name')->get(['id', 'code', 'name']),
            'it_staff' => $this->flow->itStaff()->sortBy('name')->values()->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name]),
            'other_types' => array_values((array) \App\Models\AppSetting::get('ticket_other_types', [])),
        ]]);
    }

    /** เจ้าหน้าที่ IT สำหรับ dropdown ในฟอร์มแจ้งงาน */
    public function itStaff(): JsonResponse
    {
        return response()->json(['data' => $this->flow->itStaff()->sortBy('name')->values()->map(fn (User $u) => [
            'id' => $u->id, 'name' => $u->name, 'is_it_head' => (bool) $u->is_it_head,
        ])]);
    }

    public function store(Request $request): JsonResponse
    {
        $u = $request->user();
        $data = $request->validate([
            'type' => ['required', Rule::enum(TicketType::class)],
            'type_other' => ['required_if:type,other', 'nullable', 'string', 'max:255'],
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('is_active', true)->whereNull('deleted_at')],
            'department' => ['nullable', 'string', 'max:100'],
            'division' => ['nullable', 'string', 'max:100'],
            'details' => ['required', 'string', 'max:5000'],
            'due_date' => ['nullable', 'date', 'after_or_equal:today'],
            'assignee_id' => ['nullable', 'integer', Rule::exists('users', 'id')->where('is_active', true)
                ->where(fn ($q) => $q->where('is_it_staff', true)->orWhere('is_it_head', true))],
            'person_name_th' => ['required_if:type,grant_access,revoke_access', 'nullable', 'string', 'max:255'],
            'person_name_en' => ['required_if:type,grant_access,revoke_access', 'nullable', 'string', 'max:255'],
            'device_name' => ['required_if:type,repair', 'nullable', 'string', 'max:255'],
            'asset_tag' => ['nullable', 'string', 'max:50'],
            'symptom' => ['required_if:type,repair', 'nullable', 'string', 'max:5000'],
            'photos' => ['nullable', 'array', 'max:4'],
            'photos.*' => self::PHOTO_RULE,
            'documents' => ['nullable', 'array', 'max:5'],
            'documents.*' => self::DOC_RULE,
            // ไม่บังคับแล้ว — ปกติใช้ลายเซ็นที่อัปโหลดไว้ในโปรไฟล์
            'signature' => ['nullable', 'string', 'max:500000'],
        ]);

        $ticket = DB::transaction(function () use ($request, $u, $data) {
            $type = TicketType::from($data['type']);
            $t = new ItTicket(collect($data)->except(['photos', 'documents', 'signature'])->all());
            // เก็บเฉพาะฟิลด์ที่ตรงกับเรื่อง (กันข้อมูลค้างจากการเปลี่ยนเรื่องในฟอร์ม)
            if (! $type->needsPerson()) {
                $t->person_name_th = $t->person_name_en = null;
            }
            if ($type !== TicketType::Repair) {
                $t->device_name = $t->asset_tag = $t->symptom = null;
            }
            if ($type !== TicketType::Other) {
                $t->type_other = null;
            }
            $t->asset_id = $t->asset_tag ? Asset::where('asset_tag', $t->asset_tag)->value('id') : null;
            $t->forceFill([
                'ticket_no' => ItTicket::nextTicketNo(),
                'status' => TicketStatus::PendingSupervisor,
                'requester_id' => $u->id,
                'approver_id' => $u->supervisor_id, // หัวหน้าตามสายบังคับบัญชา (null = admin อนุมัติ)
                'requested_at' => now(),
            ])->save();

            // ลายเซ็นผู้แจ้ง: ส่งมาเป็นรูปวาด (แอป/ระบบเดิม) หรือคัดลอกลายเซ็นในโปรไฟล์ ณ ตอนแจ้ง
            $signature = ! empty($data['signature'])
                ? $this->files->storeSignature($t, $data['signature'], 'requester')
                : ($u->signature_path ? $this->files->snapshotSignature($t, $u->signature_path, 'requester') : null);
            if ($signature) {
                $t->forceFill(['requester_signature' => $signature])->save();
            }
            foreach ($request->file('photos', []) as $photo) {
                $t->attachments()->create(['kind' => 'request', 'uploaded_by' => $u->id, ...$this->files->storePhoto($t, $photo, 'request')]);
            }
            foreach ($request->file('documents', []) as $doc) {
                $t->attachments()->create(['kind' => 'document', 'uploaded_by' => $u->id, ...$this->files->storePhoto($t, $doc, 'documents')]);
            }
            $t->log($u, 'submitted');

            return $t;
        });

        $this->flow->notify($ticket, 'submitted', $u);

        return $this->detail($request, $ticket, 201);
    }

    public function show(Request $request, ItTicket $ticket): JsonResponse
    {
        abort_unless($this->flow->canView($request->user(), $ticket), 403);

        return $this->detail($request, $ticket);
    }

    public function approve(Request $request, ItTicket $ticket): JsonResponse
    {
        $u = $request->user();
        abort_unless($this->flow->canApprove($u, $ticket), 403);
        $data = $request->validate(['comment' => ['nullable', 'string', 'max:2000']]);

        DB::transaction(function () use ($u, $ticket, $data) {
            $ticket->forceFill(['status' => TicketStatus::Approved, 'approver_id' => $u->id, 'approved_at' => now()])->save();
            $ticket->log($u, 'approved', $data['comment'] ?? null);
        });
        $this->flow->notify($ticket, 'approved', $u);

        return $this->detail($request, $ticket);
    }

    public function reject(Request $request, ItTicket $ticket): JsonResponse
    {
        $u = $request->user();
        abort_unless($this->flow->canApprove($u, $ticket), 403);
        $data = $request->validate(['comment' => ['required', 'string', 'max:2000']]);

        DB::transaction(function () use ($u, $ticket, $data) {
            $ticket->forceFill(['status' => TicketStatus::Rejected, 'approver_id' => $u->id, 'approved_at' => now(), 'closed_at' => now()])->save();
            $ticket->log($u, 'rejected', $data['comment']);
        });
        $this->flow->notify($ticket, 'rejected', $u);

        return $this->detail($request, $ticket);
    }

    public function accept(Request $request, ItTicket $ticket): JsonResponse
    {
        $u = $request->user();
        abort_unless($this->flow->canAccept($u, $ticket), 403);

        DB::transaction(function () use ($u, $ticket) {
            $ticket->forceFill(['status' => TicketStatus::InProgress, 'assignee_id' => $u->id, 'accepted_at' => now()])->save();
            $ticket->log($u, 'accepted');
        });
        $this->flow->notify($ticket, 'accepted', $u);

        return $this->detail($request, $ticket);
    }

    /** 4.3.2 / 4.3.3 บันทึกผลการดำเนินงาน (+ การซ่อม, รูปหลังซ่อม ≤ 4, อะไหล่พร้อมรูป ≤ 1 ต่อรายการ) */
    public function result(Request $request, ItTicket $ticket): JsonResponse
    {
        $u = $request->user();
        abort_unless($this->flow->canRecordResult($u, $ticket), 403);
        $repair = $ticket->type === TicketType::Repair;

        $data = $request->validate([
            'result' => ['required', 'in:completed,cannot_complete'],
            'completed_on' => ['required_if:result,completed', 'nullable', 'date', 'before_or_equal:today'],
            'cannot_reason' => ['required_if:result,cannot_complete', 'nullable', 'string', 'max:2000'],
            'repair_method' => [$repair ? 'required' : 'nullable', 'in:in_house,external'],
            'external_vendor' => ['required_if:repair_method,external', 'nullable', 'string', 'max:255'],
            'warranty' => [$repair ? 'required' : 'nullable', 'in:in_warranty,out_of_warranty'],
            'repair_details' => ['nullable', 'string', 'max:5000'],
            'photos' => ['nullable', 'array', 'max:4'],
            'photos.*' => self::PHOTO_RULE,
            'parts' => ['nullable', 'array', 'max:10'],
            'parts.*.name' => ['required', 'string', 'max:255'],
            'parts.*.quantity' => ['nullable', 'integer', 'min:1', 'max:999'],
            'parts.*.photo' => ['nullable', ...self::PHOTO_RULE],
            'signature' => ['required', 'string', 'max:500000'],
        ]);

        DB::transaction(function () use ($request, $u, $ticket, $data, $repair) {
            $ticket->forceFill([
                'result' => $data['result'],
                'completed_on' => $data['result'] === 'completed' ? $data['completed_on'] : null,
                'cannot_reason' => $data['result'] === 'cannot_complete' ? $data['cannot_reason'] : null,
                'repair_method' => $repair ? $data['repair_method'] : null,
                'external_vendor' => $repair && $data['repair_method'] === 'external' ? $data['external_vendor'] : null,
                'warranty' => $repair ? $data['warranty'] : null,
                'repair_details' => $data['repair_details'] ?? null,
                'staff_signature' => $this->files->storeSignature($ticket, $data['signature'], 'staff'),
                'resulted_at' => now(),
                'status' => TicketStatus::PendingItHead,
            ])->save();

            // บันทึกใหม่ทับรายการอะไหล่เดิม (กรณีถูกส่งกลับแก้ไข)
            $ticket->parts()->delete();
            foreach ($data['parts'] ?? [] as $i => $part) {
                $photo = $request->file("parts.$i.photo");
                $ticket->parts()->create([
                    'name' => $part['name'],
                    'quantity' => $part['quantity'] ?? 1,
                    'photo_path' => $photo ? $this->files->storePhoto($ticket, $photo, 'parts')['path'] : null,
                ]);
            }
            foreach ($request->file('photos', []) as $photo) {
                $ticket->attachments()->create(['kind' => 'result', 'uploaded_by' => $u->id, ...$this->files->storePhoto($ticket, $photo, 'result')]);
            }
            $ticket->log($u, 'resulted');
        });
        $this->flow->notify($ticket, 'resulted', $u);

        return $this->detail($request, $ticket);
    }

    /** 4.3.4 หัวหน้า IT อนุมัติผล (ลงลายเซ็น) → ปิดงาน */
    public function close(Request $request, ItTicket $ticket): JsonResponse
    {
        $u = $request->user();
        abort_unless($this->flow->canClose($u, $ticket), 403);
        $data = $request->validate([
            'comment' => ['nullable', 'string', 'max:2000'],
            'signature' => ['required', 'string', 'max:500000'],
        ]);

        DB::transaction(function () use ($u, $ticket, $data) {
            $ticket->forceFill([
                'status' => TicketStatus::Completed,
                'it_head_id' => $u->id,
                'it_head_signature' => $this->files->storeSignature($ticket, $data['signature'], 'it-head'),
                'closed_at' => now(),
            ])->save();
            $ticket->log($u, 'closed', $data['comment'] ?? null);
        });
        $this->flow->notify($ticket, 'closed', $u);

        return $this->detail($request, $ticket);
    }

    /** หัวหน้า IT ส่งกลับให้เจ้าหน้าที่แก้ไขผล */
    public function returnToStaff(Request $request, ItTicket $ticket): JsonResponse
    {
        $u = $request->user();
        abort_unless($this->flow->canClose($u, $ticket), 403);
        $data = $request->validate(['comment' => ['required', 'string', 'max:2000']]);

        DB::transaction(function () use ($u, $ticket, $data) {
            $ticket->forceFill(['status' => TicketStatus::InProgress])->save();
            $ticket->log($u, 'returned', $data['comment']);
        });
        $this->flow->notify($ticket, 'returned', $u);

        return $this->detail($request, $ticket);
    }

    /** ไฟล์แนบ / รูปอะไหล่ / ลายเซ็น — ส่งผ่าน API เท่านั้น (ตรวจสิทธิ์ดูใบแจ้งงาน) */
    public function file(Request $request, ItTicket $ticket, string $kind, ?int $id = null)
    {
        abort_unless($this->flow->canView($request->user(), $ticket), 403);

        $path = match ($kind) {
            'attachment' => ItTicketAttachment::where('it_ticket_id', $ticket->id)->whereKey($id)->value('path'),
            'part' => ItTicketPart::where('it_ticket_id', $ticket->id)->whereKey($id)->value('photo_path'),
            // ไม่มีสำเนาในใบงาน → ใช้ลายเซ็นปัจจุบันในโปรไฟล์ผู้แจ้ง
            'requester-signature' => $ticket->requester_signature ?? User::whereKey($ticket->requester_id)->value('signature_path'),
            'staff-signature' => $ticket->staff_signature,
            'it-head-signature' => $ticket->it_head_signature,
            default => null,
        };
        abort_unless($path, 404);

        return $this->files->response($path);
    }

    private function detail(Request $request, ItTicket $ticket, int $status = 200): JsonResponse
    {
        $ticket->load([
            'requester:id,name,email,signature_path', 'approver:id,name', 'assignee:id,name', 'itHead:id,name', 'branch:id,name',
            'asset:id,uuid,asset_tag,name', 'parts', 'attachments', 'events.user:id,name',
        ]);

        return response()->json(['data' => (new TicketResource($ticket))->detail($request->user(), $this->flow)], $status);
    }
}
