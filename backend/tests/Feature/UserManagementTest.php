<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Asset;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserManagementTest extends TestCase
{
    use RefreshDatabase;

    private function admin(): User
    {
        $admin = User::factory()->create();
        $admin->forceFill(['role' => UserRole::Admin])->save();
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_admin_can_create_user_with_role(): void
    {
        $this->admin();

        $id = $this->postJson('/api/v1/users', [
            'name' => 'New Manager', 'email' => 'MGR@example.com', 'role' => 'manager', 'password' => 'Secret123',
        ])->assertCreated()
            ->assertJsonPath('data.role', 'manager')
            ->assertJsonPath('data.email', 'mgr@example.com')
            ->assertJsonPath('data.is_active', true)
            ->json('data.id');

        $this->assertTrue(Hash::check('Secret123', User::find($id)->password));

        $this->postJson('/api/v1/users', ['name' => 'x', 'email' => 'mgr@example.com', 'role' => 'viewer', 'password' => 'short'])
            ->assertUnprocessable()->assertJsonValidationErrors(['email', 'password']);
    }

    public function test_deactivate_or_password_reset_revokes_tokens(): void
    {
        $this->admin();
        $user = User::factory()->create();
        $user->createToken('phone');

        $this->patchJson("/api/v1/users/{$user->id}", ['password' => 'NewPass123'])->assertOk();
        $this->assertSame(0, $user->tokens()->count());

        $user->createToken('phone');
        $this->patchJson("/api/v1/users/{$user->id}", ['is_active' => false])
            ->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertSame(0, $user->tokens()->count());

        // บัญชีที่ปิดใช้งาน login ไม่ได้
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'NewPass123', 'device_name' => 't'])
            ->assertUnprocessable();
    }

    public function test_admin_cannot_lock_out_or_delete_self(): void
    {
        $admin = $this->admin();

        $this->patchJson("/api/v1/users/{$admin->id}", ['role' => 'viewer'])->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->patchJson("/api/v1/users/{$admin->id}", ['is_active' => false])->assertUnprocessable()->assertJsonValidationErrors('is_active');
        $this->deleteJson("/api/v1/users/{$admin->id}")->assertUnprocessable();
        $this->patchJson("/api/v1/users/{$admin->id}", ['name' => 'Still Admin'])->assertOk();
    }

    public function test_delete_only_users_without_history(): void
    {
        $this->admin();
        $holder = User::factory()->create();
        Asset::factory()->create(['custodian_id' => $holder->id]);
        $fresh = User::factory()->create();

        $this->getJson("/api/v1/users/{$holder->id}")->assertJsonPath('meta.can_delete', false);
        $this->deleteJson("/api/v1/users/{$holder->id}")->assertUnprocessable();

        $this->deleteJson("/api/v1/users/{$fresh->id}")->assertNoContent();
        $this->assertModelMissing($fresh);
    }

    public function test_manage_list_is_admin_only_and_filters(): void
    {
        $manager = User::factory()->create();
        $manager->forceFill(['role' => UserRole::Manager])->save();
        Sanctum::actingAs($manager);
        $this->getJson('/api/v1/users?manage=1')->assertForbidden();
        $this->postJson('/api/v1/users', [])->assertForbidden();
        $this->getJson('/api/v1/users')->assertOk(); // ตัวเลือกผู้ถือครองยังใช้ได้

        $this->admin();
        $inactive = User::factory()->create(['name' => 'Zed Inactive']);
        $inactive->forceFill(['is_active' => false])->save();

        $this->getJson('/api/v1/users?manage=1&status=inactive')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Zed Inactive')
            ->assertJsonPath('meta.total', 1);
    }
}
