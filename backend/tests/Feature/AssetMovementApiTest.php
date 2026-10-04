<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\Asset;
use App\Models\Location;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssetMovementApiTest extends TestCase
{
    use RefreshDatabase;

    private function actingAsRole(UserRole $role): User
    {
        $user = User::factory()->create();
        $user->forceFill(['role' => $role])->save();
        Sanctum::actingAs($user);

        return $user;
    }

    public function test_creating_asset_with_location_records_registration(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $room = Location::factory()->create();

        $id = $this->postJson('/api/v1/assets', [
            'asset_tag' => 'IT-1', 'name' => 'Notebook', 'category' => 'IT', 'location_id' => $room->id,
        ])->assertCreated()->json('data.id');

        $this->getJson("/api/v1/assets/$id/movements")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'registered')
            ->assertJsonPath('data.0.to_location.id', $room->id)
            ->assertJsonPath('data.0.from_location', null);
    }

    public function test_updating_location_records_transfer_with_reason(): void
    {
        $manager = $this->actingAsRole(UserRole::Manager);
        [$a, $b] = Location::factory(2)->create();
        $asset = Asset::factory()->create(['location_id' => $a->id]);

        // ส่งเป็น string เหมือนค่าจากฟอร์ม เพื่อตรวจว่าเปรียบเทียบค่าเดิมถูกต้อง
        $this->patchJson("/api/v1/assets/{$asset->uuid}", ['location_id' => (string) $b->id, 'movement_reason' => 'ย้ายแผนก'])
            ->assertOk();

        $this->assertDatabaseHas('asset_movements', [
            'asset_id' => $asset->id,
            'type' => 'transfer',
            'from_location_id' => $a->id,
            'to_location_id' => $b->id,
            'reason' => 'ย้ายแผนก',
            'performed_by' => $manager->id,
        ]);
    }

    public function test_update_without_location_change_records_nothing(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $room = Location::factory()->create();
        $asset = Asset::factory()->create(['location_id' => $room->id]);

        $this->patchJson("/api/v1/assets/{$asset->uuid}", ['name' => 'Renamed', 'location_id' => (string) $room->id])
            ->assertOk();

        $this->assertDatabaseCount('asset_movements', 0);
    }

    public function test_transfer_endpoint_moves_asset_and_logs(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $room = Location::factory()->create();
        $custodian = User::factory()->create();
        $asset = Asset::factory()->create(['location_id' => null]);

        $this->postJson("/api/v1/assets/{$asset->uuid}/movements", [
            'location_id' => $room->id,
            'custodian_id' => $custodian->id,
            'moved_at' => now()->subDay()->toDateTimeString(),
            'reason' => 'มอบให้พนักงานใหม่',
        ])->assertCreated()
            ->assertJsonPath('data.to_location.id', $room->id)
            ->assertJsonPath('data.to_custodian.id', $custodian->id);

        $asset->refresh();
        $this->assertSame($room->id, $asset->location_id);
        $this->assertSame($custodian->id, $asset->custodian_id);
    }

    public function test_transfer_without_change_is_rejected(): void
    {
        $this->actingAsRole(UserRole::Manager);
        $room = Location::factory()->create();
        $asset = Asset::factory()->create(['location_id' => $room->id]);

        $this->postJson("/api/v1/assets/{$asset->uuid}/movements", ['location_id' => $room->id])
            ->assertUnprocessable()->assertJsonValidationErrors('location_id');
        $this->postJson("/api/v1/assets/{$asset->uuid}/movements", ['reason' => 'x'])
            ->assertUnprocessable()->assertJsonValidationErrors('location_id');
        $this->postJson("/api/v1/assets/{$asset->uuid}/movements", [
            'location_id' => Location::factory()->create()->id, 'moved_at' => now()->addDay()->toDateTimeString(),
        ])->assertUnprocessable()->assertJsonValidationErrors('moved_at');
    }

    public function test_viewer_can_read_history_but_not_transfer(): void
    {
        $this->actingAsRole(UserRole::Viewer);
        $asset = Asset::factory()->create();

        $this->getJson("/api/v1/assets/{$asset->uuid}/movements")->assertOk();
        $this->postJson("/api/v1/assets/{$asset->uuid}/movements", ['location_id' => Location::factory()->create()->id])
            ->assertForbidden();
    }
}
