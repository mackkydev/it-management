<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\ItTicket;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** ลายเซ็นในโปรไฟล์ → แสตมป์ลงใบแจ้งงาน (ตรงกับ express/tests/signature.test.ts) */
class ProfileSignatureTest extends TestCase
{
    use RefreshDatabase;

    public function test_upload_replace_delete_and_stamp_on_ticket(): void
    {
        Storage::fake('local');
        $branch = Branch::create(['code' => 'KKN', 'name' => 'ขอนแก่น']);
        $user = User::factory()->create()->refresh();
        Sanctum::actingAs($user);

        $this->post('/api/v1/auth/me/signature', ['signature' => UploadedFile::fake()->create('sig.pdf', 5, 'application/pdf')], ['Accept' => 'application/json'])
            ->assertUnprocessable()->assertJsonValidationErrors('signature');

        $url = $this->post('/api/v1/auth/me/signature', ['signature' => UploadedFile::fake()->image('sig.png')], ['Accept' => 'application/json'])
            ->assertOk()->json('data.signature_url');
        $this->assertMatchesRegularExpression('#^/auth/me/signature\?v=signature-[A-Za-z0-9]{16}$#', $url);
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.signature_url', $url);
        $this->get('/api/v1/auth/me/signature')->assertOk();

        // แจ้งงานโดยไม่ส่งลายเซ็น → คัดลอกลายเซ็นในโปรไฟล์ไว้กับใบงาน
        $id = $this->postJson('/api/v1/tickets', ['type' => 'install', 'branch_id' => $branch->id, 'details' => 'x'])
            ->assertCreated()->json('data.id');
        $this->assertStringStartsWith("tickets/$id/signatures/requester-", ItTicket::where('uuid', $id)->value('requester_signature'));

        // ลบลายเซ็นในโปรไฟล์แล้ว ใบงานยังมีลายเซ็นเดิม
        $this->deleteJson('/api/v1/auth/me/signature')->assertNoContent();
        $this->getJson('/api/v1/auth/me')->assertJsonPath('data.signature_url', null);
        $this->get("/api/v1/tickets/$id/files/requester-signature")->assertOk();
    }
}
