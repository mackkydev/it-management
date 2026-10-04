<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Asset;
use App\Models\Location;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class LocationApiTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsRole(UserRole $role): User
    {
        $user = User::factory()->create();
        $user->forceFill(['role' => $role])->save();
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_manager_can_create_and_update_location(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $site = Location::factory()->create(['type' => 'site']);

        $id = $this->postJson('/api/v1/locations', [
            'code' => 'HQ-C', 'name' => 'อาคาร C', 'type' => 'building', 'parent_id' => $site->id,
        ])->assertCreated()
            ->assertJsonPath('data.is_active', true)
            ->assertJsonPath('data.parent_id', $site->id)
            ->json('data.id');

        $this->patchJson("/api/v1/locations/$id", ['name' => 'อาคาร C (ใหม่)', 'is_active' => false])
            ->assertOk()
            ->assertJsonPath('data.name', 'อาคาร C (ใหม่)')
            ->assertJsonPath('data.is_active', false);

        // ปิดใช้งานแล้วไม่แสดงใน dropdown แต่ยังเห็นในหน้าจัดการ
        $this->getJson('/api/v1/locations')->assertJsonMissing(['id' => $id]);
        $this->getJson('/api/v1/locations?include_inactive=1')
            ->assertJsonFragment(['id' => $id, 'children_count' => 0, 'assets_count' => 0]);
    }

    public function test_code_must_be_unique_and_parent_cannot_create_cycle(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $a = Location::factory()->create(['code' => 'A']);
        $b = Location::factory()->create(['code' => 'B', 'parent_id' => $a->id]);
        $c = Location::factory()->create(['code' => 'C', 'parent_id' => $b->id]);

        $this->postJson('/api/v1/locations', ['code' => 'A', 'name' => 'x', 'type' => 'room'])
            ->assertUnprocessable()->assertJsonValidationErrors('code');

        $this->patchJson("/api/v1/locations/{$a->id}", ['parent_id' => $c->id])
            ->assertUnprocessable()->assertJsonValidationErrors('parent_id');
        $this->patchJson("/api/v1/locations/{$a->id}", ['parent_id' => $a->id])
            ->assertUnprocessable()->assertJsonValidationErrors('parent_id');
    }

    public function test_delete_is_blocked_while_location_has_children_or_assets(): void
    {
        $this->actingAsRole(UserRole::Admin);
        $parent = Location::factory()->create();
        $child = Location::factory()->create(['parent_id' => $parent->id]);
        Asset::factory()->create(['location_id' => $child->id]);

        $this->deleteJson("/api/v1/locations/{$parent->id}")->assertUnprocessable();
        $this->deleteJson("/api/v1/locations/{$child->id}")->assertUnprocessable();

        $empty = Location::factory()->create();
        $this->deleteJson("/api/v1/locations/{$empty->id}")->assertNoContent();
        $this->assertSoftDeleted($empty);
    }

    public function test_permissions(): void
    {
        $this->actingAsRole(UserRole::Viewer);
        $loc = Location::factory()->create();

        $this->getJson('/api/v1/locations')->assertOk();
        $this->getJson("/api/v1/locations/{$loc->id}")->assertOk();
        $this->getJson('/api/v1/locations?include_inactive=1')->assertForbidden();
        $this->postJson('/api/v1/locations', ['code' => 'X', 'name' => 'x', 'type' => 'room'])->assertForbidden();

        $this->actingAsRole(UserRole::Manager);
        $this->deleteJson("/api/v1/locations/{$loc->id}")->assertForbidden();
    }
}
