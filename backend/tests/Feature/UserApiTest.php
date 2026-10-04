<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class UserApiTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsRole(UserRole $role): User
    {
        $user = User::factory()->create(['name' => 'Acting User']);
        $user->forceFill(['role' => $role])->save();
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_manager_can_search_active_users_only(): void
    {
        $this->actingAsRole(UserRole::Manager);
        User::factory()->create(['name' => 'Somchai Jaidee', 'email' => 'somchai@example.com']);
        $inactive = User::factory()->create(['name' => 'Somchai Retired']);
        $inactive->forceFill(['is_active' => false])->save();

        $this->getJson('/api/v1/users?search=somchai')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.name', 'Somchai Jaidee')
            ->assertJsonMissingPath('data.0.role');
    }

    public function test_viewer_cannot_list_users(): void
    {
        $this->actingAsRole(UserRole::Viewer);

        $this->getJson('/api/v1/users')->assertForbidden();
    }

    public function test_asset_custodian_must_be_active_user(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $active = User::factory()->create();
        $inactive = User::factory()->create();
        $inactive->forceFill(['is_active' => false])->save();

        $base = ['name' => 'Notebook', 'category' => 'IT'];

        $this->postJson('/api/v1/assets', $base + ['asset_tag' => 'IT-1', 'custodian_id' => $inactive->id])
            ->assertUnprocessable()->assertJsonValidationErrors('custodian_id');

        $this->postJson('/api/v1/assets', $base + ['asset_tag' => 'IT-2', 'custodian_id' => $active->id])
            ->assertCreated()->assertJsonPath('data.custodian.id', $active->id);
    }
}
