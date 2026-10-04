<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\AppSetting;
use App\Models\Branch;
use App\Models\Contract;
use App\Models\Credential;
use App\Models\User;
use App\Notifications\ExpiringItemsDigest;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** คลังรหัสผ่าน / สัญญา + แจ้งเตือน / สาขา / ตั้งค่า */
class ItDataTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $attrs = []): User
    {
        $u = User::factory()->create();
        $u->forceFill(['role' => UserRole::Viewer, ...$attrs])->save();

        return $u->refresh();
    }

    public function test_credentials_are_encrypted_hidden_and_reveal_is_logged(): void
    {
        $it = $this->user(['is_it_staff' => true]);
        Sanctum::actingAs($it);

        $id = $this->postJson('/api/v1/credentials', [
            'title' => 'Firewall', 'category' => 'network', 'username' => 'admin', 'password' => 'S3cret!pass',
        ])->assertCreated()->assertJsonPath('data.has_password', true)->assertJsonMissingPath('data.password')->json('data.id');

        // เก็บแบบเข้ารหัสในฐานข้อมูล
        $raw = DB::table('credentials')->where('id', $id)->value('password');
        $this->assertNotSame('S3cret!pass', $raw);
        $this->assertStringNotContainsString('S3cret', $raw);

        $this->getJson('/api/v1/credentials')->assertOk()->assertJsonMissing(['password' => 'S3cret!pass']);
        $this->postJson("/api/v1/credentials/$id/reveal")->assertOk()->assertJsonPath('data.password', 'S3cret!pass');
        $this->getJson("/api/v1/credentials/$id/logs")->assertJsonPath('data.0.action', 'reveal');

        // ไม่ส่ง password มา = คงเดิม
        $this->patchJson("/api/v1/credentials/$id", ['title' => 'Firewall HQ'])->assertOk();
        $this->assertSame('S3cret!pass', Credential::find($id)->password);

        Sanctum::actingAs($this->user());
        $this->getJson('/api/v1/credentials')->assertForbidden();
        $this->postJson("/api/v1/credentials/$id/reveal")->assertForbidden();
    }

    public function test_contract_status_and_expiry_notification_sent_once(): void
    {
        Notification::fake();
        $it = $this->user(['is_it_staff' => true]);
        AppSetting::put('notify_emails', ['it@example.com', 'boss@example.com']);
        AppSetting::put('contract_notify_days', 30);

        Contract::create(['title' => 'MA Server', 'vendor_name' => 'ABC', 'start_date' => now()->subYear(), 'end_date' => now()->addDays(10)]);
        Contract::create(['title' => 'Internet', 'vendor_name' => 'ISP', 'start_date' => now()->subYear(), 'end_date' => now()->addDays(60)]);
        Contract::create(['title' => 'Custom', 'vendor_name' => 'X', 'start_date' => now(), 'end_date' => now()->addDays(80), 'notify_days_before' => 90]);

        Sanctum::actingAs($it);
        $this->getJson('/api/v1/contracts')->assertOk()->assertJsonPath('summary.expiring', 2)->assertJsonPath('summary.active', 1);
        $this->getJson('/api/v1/contracts?status=expiring')->assertJsonCount(2, 'data');

        $this->artisan('it:notify-expiring')->assertSuccessful();
        Notification::assertSentTo(new AnonymousNotifiable, ExpiringItemsDigest::class,
            fn ($n, $channels, $notifiable) => count($n->items) === 2 && in_array($notifiable->routes['mail'], ['it@example.com', 'boss@example.com'], true));
        Notification::assertSentTo($it, ExpiringItemsDigest::class);
        Notification::assertSentTimes(ExpiringItemsDigest::class, 3); // 2 อีเมล + 1 ผู้ใช้ IT

        // รันซ้ำวันถัดไป: ไม่ส่งซ้ำรายการเดิม
        $this->artisan('it:notify-expiring')->expectsOutputToContain('ไม่มีรายการ')->assertSuccessful();
    }

    public function test_settings_and_branches_are_admin_only(): void
    {
        Sanctum::actingAs($this->user());
        $this->getJson('/api/v1/settings')->assertForbidden();
        $this->postJson('/api/v1/branches', ['code' => 'X', 'name' => 'X'])->assertForbidden();
        $this->getJson('/api/v1/branches')->assertOk(); // ทุกคนดูรายการสาขาได้ (ใช้ในฟอร์มแจ้งงาน)

        Sanctum::actingAs($this->user(['role' => UserRole::Admin]));
        $this->putJson('/api/v1/settings', ['notify_emails' => ['A@x.com', 'bad'], 'contract_notify_days' => 45])
            ->assertUnprocessable()->assertJsonValidationErrors('notify_emails.1');
        $this->putJson('/api/v1/settings', ['notify_emails' => ['A@x.com', 'b@y.com'], 'contract_notify_days' => 45])
            ->assertOk()->assertJsonPath('data.notify_emails', ['a@x.com', 'b@y.com'])->assertJsonPath('data.contract_notify_days', 45);

        $id = $this->postJson('/api/v1/branches', ['code' => 'PKT', 'name' => 'ภูเก็ต'])->assertCreated()->json('data.id');
        $this->user(['branch_id' => $id]);
        $this->deleteJson("/api/v1/branches/$id")->assertUnprocessable(); // มีผู้ใช้สังกัด → ลบไม่ได้
        $empty = Branch::create(['code' => 'EMP', 'name' => 'ว่าง']);
        $this->deleteJson("/api/v1/branches/{$empty->id}")->assertNoContent();
    }

    public function test_notifications_endpoint(): void
    {
        $u = $this->user();
        $u->notify(new ExpiringItemsDigest([['type' => 'contract', 'title' => 'A', 'sub' => null, 'date' => '2026-12-01', 'days_left' => 5]]));
        Sanctum::actingAs($u);

        $id = $this->getJson('/api/v1/notifications')->assertOk()->assertJsonPath('unread_count', 1)->json('data.0.id');
        $this->postJson("/api/v1/notifications/$id/read")->assertNoContent();
        $this->getJson('/api/v1/notifications')->assertJsonPath('unread_count', 0);
    }
}
