<?php

namespace Tests\Feature;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/** บันทึก KPI + ui-config (ตรงกับ express/tests/kpi-permissions.test.ts) */
class KpiAndUiConfigTest extends TestCase
{
    use RefreshDatabase;

    private function user(array $attrs = []): User
    {
        $u = User::factory()->create();
        $u->forceFill(['role' => UserRole::Viewer, ...$attrs])->save();

        return $u->refresh();
    }

    public function test_kpi_own_entries_and_it_head_view(): void
    {
        $staff = $this->user(['name' => 'Staff']);
        $other = $this->user();
        $head = $this->user(['is_it_head' => true]);

        Sanctum::actingAs($staff);
        $this->postJson('/api/v1/kpi', ['work_date' => now()->addDays(2)->toDateString(), 'details' => ''], ['Accept-Language' => 'th'])
            ->assertUnprocessable()->assertJsonValidationErrors(['work_date', 'details'])
            ->assertJsonPath('errors.work_date.0', 'วันที่ปฏิบัติงานต้องไม่เป็นวันในอนาคต');
        // วันที่ตามเวลาไทยอาจเป็น "พรุ่งนี้" ของ UTC (00:00–07:00) — ต้องบันทึกได้
        $early = $this->postJson('/api/v1/kpi', ['work_date' => now()->addDay()->toDateString(), 'details' => 'เช้ามืด'])->assertCreated()->json('data.id');
        $this->deleteJson("/api/v1/kpi/$early")->assertNoContent();
        $id = $this->postJson('/api/v1/kpi', ['work_date' => now()->toDateString(), 'details' => 'ติดตั้งโปรแกรม'])
            ->assertCreated()->assertJsonPath('data.user.name', 'Staff')->assertJsonPath('data.can_edit', true)->json('data.id');
        $this->getJson("/api/v1/kpi?user_id={$other->id}")->assertForbidden();

        Sanctum::actingAs($other);
        $this->postJson('/api/v1/kpi', ['work_date' => now()->toDateString(), 'details' => 'แก้เครือข่าย'])->assertCreated();
        $this->getJson('/api/v1/kpi')->assertJsonPath('meta.total', 1);
        $this->patchJson("/api/v1/kpi/$id", ['details' => 'x'])->assertForbidden();

        Sanctum::actingAs($head);
        $this->getJson('/api/v1/kpi')->assertJsonPath('meta.total', 2);

        Sanctum::actingAs($staff);
        $this->patchJson("/api/v1/kpi/$id", ['details' => 'ติดตั้ง 4 เครื่อง'])->assertOk()->assertJsonPath('data.details', 'ติดตั้ง 4 เครื่อง');
        $this->deleteJson("/api/v1/kpi/$id")->assertNoContent();
    }

    public function test_ui_config_read_by_all_written_by_admin(): void
    {
        Sanctum::actingAs($this->user());
        $this->getJson('/api/v1/ui-config')->assertOk()->assertExactJson(['data' => ['ui_permissions' => [], 'menu_order' => []]]);
        $this->putJson('/api/v1/settings', ['ui_permissions' => []])->assertForbidden();

        Sanctum::actingAs($this->user(['role' => UserRole::Admin]));
        $this->putJson('/api/v1/settings', ['ui_permissions' => ['/vault' => ['hacker']]])->assertUnprocessable();
        $payload = [
            'ui_permissions' => ['/kpi' => ['viewer'], 'btn:tickets:print' => ['viewer', 'manager']],
            'menu_order' => ['groups' => ['assets', 'it-work'], 'items' => ['it-work' => ['/kpi', '/tickets/new']]],
        ];
        $this->putJson('/api/v1/settings', $payload)->assertOk();
        $this->getJson('/api/v1/ui-config')->assertExactJson(['data' => $payload]);
    }
}
