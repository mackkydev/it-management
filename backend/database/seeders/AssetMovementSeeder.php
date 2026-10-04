<?php

namespace Database\Seeders;

use App\Enums\MovementType;
use App\Models\Asset;
use App\Models\AssetMovement;
use App\Models\Location;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/**
 * สร้างประวัติการโอนย้ายตัวอย่างให้สินทรัพย์ที่ยังไม่มีประวัติ (รันซ้ำได้ — ข้ามรายการที่มีประวัติแล้ว)
 * ประวัติจะต่อกันจนจบที่สถานที่/ผู้ถือครองปัจจุบันของสินทรัพย์เสมอ
 *   php artisan db:seed --class=AssetMovementSeeder
 */
class AssetMovementSeeder extends Seeder
{
    public function run(): void
    {
        $admin = User::where('email', 'admin@example.com')->first();
        $rooms = Location::where('type', 'room')->pluck('id');
        $staff = User::where('is_active', true)->pluck('id');

        Asset::query()
            ->whereDoesntHave('movements')
            ->select(['id', 'location_id', 'custodian_id', 'purchase_date', 'created_at'])
            ->chunkById(200, function ($assets) use ($admin, $rooms, $staff) {
                $rows = [];
                foreach ($assets as $asset) {
                    $start = Carbon::parse($asset->purchase_date ?? $asset->created_at);
                    $hops = fake()->numberBetween(0, 3); // จำนวนครั้งที่เคยย้ายก่อนถึงตำแหน่งปัจจุบัน

                    // สร้างเส้นทางย้อนหลัง: จุดสุดท้ายคือค่าปัจจุบันของสินทรัพย์
                    $path = [];
                    for ($i = 0; $i < $hops; $i++) {
                        $path[] = [$rooms->random(), fake()->boolean(50) ? $staff->random() : null];
                    }
                    $path[] = [$asset->location_id, $asset->custodian_id];

                    $when = $start->copy();
                    $span = max(1, (int) $start->diffInDays(now()));
                    $prev = [null, null];
                    foreach ($path as $i => [$loc, $cust]) {
                        $when = $i === 0 ? $start->copy() : $when->copy()->addDays(fake()->numberBetween(1, max(1, intdiv($span, $hops + 1))));
                        $rows[] = [
                            'asset_id' => $asset->id,
                            'type' => $i === 0 ? MovementType::Registered->value : MovementType::Transfer->value,
                            'from_location_id' => $prev[0],
                            'to_location_id' => $loc,
                            'from_custodian_id' => $prev[1],
                            'to_custodian_id' => $cust,
                            'moved_at' => min($when, now()),
                            'reason' => $i === 0 ? null : fake()->randomElement([
                                'ย้ายตามโครงสร้างแผนกใหม่', 'โอนให้พนักงานใหม่', 'ย้ายห้องประชุม', 'คืนเข้าคลัง', null,
                            ]),
                            'performed_by' => $admin?->id,
                            'created_at' => now(),
                        ];
                        $prev = [$loc, $cust];
                    }
                }
                AssetMovement::insert($rows); // bulk insert ลดจำนวน query
            });
    }
}
