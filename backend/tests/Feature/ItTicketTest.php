<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Asset;
use App\Models\Branch;
use App\Models\ItTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ItTicketTest extends TestCase
{
    use RefreshDatabase;

    /** PNG 1x1 สำหรับลายเซ็น */
    private const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

    private Branch $branch;
    private User $chief;
    private User $staff;
    private User $it;
    private User $itHead;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');

        $this->branch = Branch::create(['code' => 'KKN', 'name' => 'ขอนแก่น']);
        $this->chief = $this->user(['name' => 'Chief']);
        $this->staff = $this->user(['name' => 'Staff', 'supervisor_id' => $this->chief->id, 'branch_id' => $this->branch->id]);
        $this->it = $this->user(['name' => 'IT', 'is_it_staff' => true]);
        $this->itHead = $this->user(['name' => 'IT Head', 'is_it_head' => true]);
    }

    private function user(array $attrs): User
    {
        $u = User::factory()->create();
        $u->forceFill(['role' => UserRole::Viewer, ...$attrs])->save();

        return $u->refresh();
    }

    private function submitRepair(array $extra = []): string
    {
        Sanctum::actingAs($this->staff);
        $asset = Asset::factory()->create(['asset_tag' => 'IT-2026-000001']);

        return $this->post('/api/v1/tickets', [
            'type' => 'repair',
            'branch_id' => $this->branch->id,
            'department' => 'ขาย',
            'division' => 'ขาย',
            'details' => 'จอไม่ติด',
            'due_date' => now()->addDays(3)->toDateString(),
            'assignee_id' => $this->it->id,
            'device_name' => 'Monitor',
            'asset_tag' => $asset->asset_tag,
            'symptom' => 'เปิดไม่ติด มีเสียงแต่ไม่มีภาพ',
            'person_name_th' => 'ไม่ควรถูกเก็บ',
            'photos' => [UploadedFile::fake()->image('a.jpg')->size(500), UploadedFile::fake()->image('b.png')->size(300)],
            'documents' => [UploadedFile::fake()->create('quote.pdf', 800, 'application/pdf')],
            'signature' => self::SIG,
            ...$extra,
        ], ['Accept' => 'application/json'])->assertCreated()
            ->assertJsonPath('data.status', 'pending_supervisor')
            ->assertJsonPath('data.approver.name', 'Chief') // หัวหน้าตามสายบังคับบัญชาของผู้แจ้ง
            ->assertJsonPath('data.asset.asset_tag', 'IT-2026-000001')
            ->assertJsonPath('data.person_name_th', null)
            ->assertJsonCount(3, 'data.attachments')
            ->json('data.id');
    }

    public function test_full_workflow_from_request_to_close(): void
    {
        $id = $this->submitRepair();
        $ticket = ItTicket::where('uuid', $id)->first();
        $this->assertSame($this->chief->id, $ticket->approver_id);
        $this->assertMatchesRegularExpression('/^IT-\d{4}-00001$/', $ticket->ticket_no);
        $this->assertSame(1, $this->chief->unreadNotifications()->count()); // แจ้งหัวหน้า

        // หัวหน้าเท่านั้นที่อนุมัติได้
        Sanctum::actingAs($this->it);
        $this->postJson("/api/v1/tickets/$id/approve")->assertForbidden();
        Sanctum::actingAs($this->chief);
        $this->getJson('/api/v1/tickets?scope=approvals')->assertJsonPath('counts.approvals', 1);
        $this->postJson("/api/v1/tickets/$id/approve", ['comment' => 'ok'])->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertSame(1, $this->it->unreadNotifications()->count()); // แจ้งเจ้าหน้าที่ IT ที่เลือกไว้

        // IT รับงาน
        Sanctum::actingAs($this->it);
        $this->postJson("/api/v1/tickets/$id/accept")->assertOk()->assertJsonPath('data.status', 'in_progress');

        // งานซ่อมต้องระบุลักษณะงานซ่อม/การรับประกัน
        $this->post("/api/v1/tickets/$id/result", ['result' => 'completed', 'completed_on' => now()->toDateString(), 'signature' => self::SIG], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors(['repair_method', 'warranty']);

        $this->post("/api/v1/tickets/$id/result", [
            'result' => 'completed',
            'completed_on' => now()->toDateString(),
            'repair_method' => 'external',
            'external_vendor' => 'ABC Service',
            'warranty' => 'out_of_warranty',
            'repair_details' => 'เปลี่ยนบอร์ดจ่ายไฟ',
            'photos' => [UploadedFile::fake()->image('after.jpg')->size(400)],
            'parts' => [
                ['name' => 'Power board', 'quantity' => 1, 'photo' => UploadedFile::fake()->image('p.jpg')->size(200)],
                ['name' => 'สายไฟ', 'quantity' => 2],
            ],
            'signature' => self::SIG,
        ], ['Accept' => 'application/json'])->assertOk()
            ->assertJsonPath('data.status', 'pending_it_head')
            ->assertJsonCount(2, 'data.parts')
            ->assertJsonPath('data.signatures.staff', "/tickets/$id/files/staff-signature");
        $this->assertSame(1, $this->itHead->unreadNotifications()->count());

        // หัวหน้า IT ส่งกลับ แล้วอนุมัติ
        Sanctum::actingAs($this->itHead);
        $this->postJson("/api/v1/tickets/$id/return", ['comment' => 'แนบรูปเพิ่ม'])->assertOk()->assertJsonPath('data.status', 'in_progress');
        Sanctum::actingAs($this->it);
        $this->post("/api/v1/tickets/$id/result", [
            'result' => 'completed', 'completed_on' => now()->toDateString(), 'repair_method' => 'in_house',
            'warranty' => 'in_warranty', 'signature' => self::SIG,
        ], ['Accept' => 'application/json'])->assertOk()->assertJsonCount(0, 'data.parts');
        Sanctum::actingAs($this->itHead);
        $this->postJson("/api/v1/tickets/$id/close", ['signature' => self::SIG])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.it_head.id', $this->itHead->id)
            // submitted, approved, accepted, resulted, returned, resulted, closed
            ->assertJsonCount(7, 'data.events');
    }

    public function test_access_requests_require_names_and_other_requires_text(): void
    {
        Sanctum::actingAs($this->staff);
        $this->post('/api/v1/tickets', [
            'type' => 'grant_access', 'branch_id' => $this->branch->id, 'details' => 'VPN', 'signature' => self::SIG,
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors(['person_name_th', 'person_name_en']);

        $this->post('/api/v1/tickets', [
            'type' => 'other', 'branch_id' => $this->branch->id, 'details' => 'ออกแบบโลโก้', 'signature' => self::SIG,
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('type_other');

        $this->post('/api/v1/tickets', [
            'type' => 'other', 'type_other' => 'งานออกแบบ', 'branch_id' => $this->branch->id, 'details' => 'ออกแบบโลโก้', 'signature' => self::SIG,
        ], ['Accept' => 'application/json'])->assertCreated()->assertJsonPath('data.type_other', 'งานออกแบบ');
    }

    public function test_upload_limits_and_signature_validation(): void
    {
        Sanctum::actingAs($this->staff);
        $base = ['type' => 'install', 'branch_id' => $this->branch->id, 'details' => 'ติดตั้งโปรแกรม'];

        $this->post('/api/v1/tickets', [...$base, 'signature' => self::SIG,
            'photos' => array_map(fn ($i) => UploadedFile::fake()->image("$i.jpg"), range(1, 5)),
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('photos');

        $this->post('/api/v1/tickets', [...$base, 'signature' => self::SIG,
            'photos' => [UploadedFile::fake()->image('big.jpg')->size(1500)],
        ], ['Accept' => 'application/json'])->assertUnprocessable()->assertJsonValidationErrors('photos.0');

        $this->post('/api/v1/tickets', [...$base, 'signature' => 'data:image/png;base64,bm90LWEtcG5n'], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('signature');
    }

    public function test_visibility_and_files(): void
    {
        $id = $this->submitRepair();
        $outsider = $this->user(['name' => 'Outsider']);

        Sanctum::actingAs($outsider);
        $this->getJson("/api/v1/tickets/$id")->assertForbidden();
        $this->get("/api/v1/tickets/$id/files/requester-signature")->assertForbidden();

        Sanctum::actingAs($this->it); // IT เห็นทุกใบ
        $this->getJson("/api/v1/tickets/$id")->assertOk();
        $attachment = $this->getJson("/api/v1/tickets/$id")->json('data.attachments.0.url');
        $this->get("/api/v1{$attachment}")->assertOk();
        $this->get("/api/v1/tickets/$id/files/requester-signature")->assertOk()->assertHeader('Content-Type', 'image/png');

        Sanctum::actingAs($this->staff);
        $this->getJson('/api/v1/tickets?scope=it')->assertForbidden();
        $this->getJson('/api/v1/tickets?scope=mine')->assertOk()->assertJsonPath('meta.total', 1);
    }

    public function test_requester_without_supervisor_is_approved_by_admin(): void
    {
        $lonely = $this->user(['name' => 'No boss']);
        $admin = $this->user(['role' => UserRole::Admin]);
        Sanctum::actingAs($lonely);
        $id = $this->post('/api/v1/tickets', [
            'type' => 'install', 'branch_id' => $this->branch->id, 'details' => 'x', 'signature' => self::SIG,
        ], ['Accept' => 'application/json'])->assertCreated()->json('data.id');
        $this->assertSame(1, $admin->unreadNotifications()->count());

        Sanctum::actingAs($admin);
        $this->postJson("/api/v1/tickets/$id/reject")->assertUnprocessable(); // ต้องมีเหตุผล
        $this->postJson("/api/v1/tickets/$id/reject", ['comment' => 'ข้อมูลไม่ครบ'])->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->assertSame(1, $lonely->unreadNotifications()->count());
    }
}
