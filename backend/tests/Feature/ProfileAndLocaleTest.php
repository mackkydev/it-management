<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Asset;
use App\Models\Location;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class ProfileAndLocaleTest extends TestCase
{
    use RefreshDatabase;

    public function test_user_can_update_own_name_and_email_but_not_role(): void
    {
        $user = User::factory()->create();
        Sanctum::actingAs($user);

        $this->patchJson('/api/v1/auth/me', ['name' => 'New Name', 'email' => 'NEW@Example.com', 'role' => 'admin'])
            ->assertOk()
            ->assertJsonPath('data.name', 'New Name')
            ->assertJsonPath('data.email', 'new@example.com')
            ->assertJsonPath('data.role', 'viewer');
    }

    public function test_password_change_requires_current_password_and_revokes_other_tokens(): void
    {
        $user = User::factory()->create(['password' => 'old-pass-1']);
        $user->createToken('other-device');
        $token = $user->createToken('this-device')->plainTextToken;
        $auth = ['Authorization' => "Bearer $token"];

        $this->putJson('/api/v1/auth/password', [
            'current_password' => 'wrong', 'password' => 'new-pass-2', 'password_confirmation' => 'new-pass-2',
        ], $auth)->assertUnprocessable()->assertJsonValidationErrors('current_password');

        $this->putJson('/api/v1/auth/password', [
            'current_password' => 'old-pass-1', 'password' => 'new-pass-2', 'password_confirmation' => 'new-pass-2',
        ], $auth)->assertNoContent();

        $this->assertTrue(Hash::check('new-pass-2', $user->fresh()->password));
        $this->assertSame(['this-device'], $user->tokens()->pluck('name')->all());
    }

    public function test_messages_follow_accept_language(): void
    {
        $manager = User::factory()->create();
        $manager->forceFill(['role' => UserRole::Manager])->save();
        Sanctum::actingAs($manager);
        Asset::factory()->create(['status' => 'in_repair']);

        $this->getJson('/api/v1/assets', ['Accept-Language' => 'en'])
            ->assertJsonPath('data.0.status_label', 'In repair')
            ->assertHeader('Content-Language', 'en');
        $this->getJson('/api/v1/assets', ['Accept-Language' => 'th-TH,th;q=0.9'])
            ->assertJsonPath('data.0.status_label', 'ส่งซ่อม');

        $this->postJson('/api/v1/assets', [], ['Accept-Language' => 'th'])
            ->assertJsonPath('errors.asset_tag.0', 'กรุณากรอกเลขครุภัณฑ์');
        $this->postJson('/api/v1/assets', [], ['Accept-Language' => 'en'])
            ->assertJsonPath('errors.asset_tag.0', 'The asset tag field is required.');
    }

    public function test_global_movements_report_filters_by_asset_tag(): void
    {
        $manager = User::factory()->create();
        $manager->forceFill(['role' => UserRole::Manager])->save();
        Sanctum::actingAs($manager);
        $room = Location::factory()->create();

        foreach (['IT-AAA-1', 'IT-BBB-1'] as $tag) {
            $this->postJson('/api/v1/assets', ['asset_tag' => $tag, 'name' => 'x', 'category' => 'IT', 'location_id' => $room->id])
                ->assertCreated();
        }

        $this->getJson('/api/v1/movements?search=IT-AAA')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.asset.asset_tag', 'IT-AAA-1');
    }
}
