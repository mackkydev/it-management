<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Asset;
use App\Models\Location;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssetApiTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsRole(UserRole $role): User
    {
        $user = User::factory()->create();
        $user->forceFill(['role' => $role])->save();
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_guest_gets_401_json(): void
    {
        $this->getJson('/api/v1/assets')->assertUnauthorized();
        $this->get('/api/v1/assets')->assertUnauthorized()->assertHeader('Content-Type', 'application/json');
    }

    public function test_login_returns_bearer_token(): void
    {
        User::factory()->create(['email' => 'a@example.com', 'password' => 'secret-pass']);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'a@example.com', 'password' => 'secret-pass', 'device_name' => 'phpunit',
        ])->assertOk()->assertJsonStructure(['token', 'token_type', 'expires_at', 'user' => ['id', 'role']]);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'a@example.com', 'password' => 'wrong', 'device_name' => 'phpunit',
        ])->assertUnprocessable();
    }

    public function test_index_paginates_and_filters(): void
    {
        $this->actingAsRole(UserRole::Viewer);
        Asset::factory(5)->create(['status' => 'active']);
        Asset::factory(2)->create(['status' => 'in_repair']);

        $this->getJson('/api/v1/assets?status=in_repair&per_page=10')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.total', 2)
            ->assertJsonMissingPath('data.0.uuid');

        $this->getJson('/api/v1/assets?sort=password')->assertUnprocessable();
    }

    public function test_manager_can_create_and_update_but_not_delete(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $location = Location::factory()->create();

        $id = $this->postJson('/api/v1/assets', [
            'asset_tag' => 'IT-2026-000001',
            'name' => 'Notebook',
            'category' => 'IT',
            'location_id' => $location->id,
        ])->assertCreated()->assertJsonPath('data.status', 'active')->json('data.id');

        $this->patchJson("/api/v1/assets/$id", ['status' => 'in_repair'])
            ->assertOk()->assertJsonPath('data.status', 'in_repair');

        $this->deleteJson("/api/v1/assets/$id")->assertForbidden();
    }

    public function test_viewer_cannot_create(): void
    {
        $this->actingAsRole(UserRole::Viewer);

        $this->postJson('/api/v1/assets', ['asset_tag' => 'X-1', 'name' => 'x', 'category' => 'IT'])
            ->assertForbidden();
    }

    public function test_admin_soft_deletes(): void
    {
        $this->actingAsRole(UserRole::Admin);
        $asset = Asset::factory()->create();

        $this->deleteJson("/api/v1/assets/{$asset->uuid}")->assertNoContent();
        $this->assertSoftDeleted($asset);
    }
}
