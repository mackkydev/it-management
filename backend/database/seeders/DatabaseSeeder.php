<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Asset;
use App\Models\Location;
use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $admin = User::firstOrNew(['email' => 'admin@example.com']);
        $admin->forceFill([
            'name' => 'System Admin',
            'password' => env('SEED_ADMIN_PASSWORD', 'ChangeMe!2026'),
            'role' => UserRole::Admin,
            'email_verified_at' => now(),
        ])->save();

        $viewer = User::firstOrNew(['email' => 'viewer@example.com']);
        $viewer->forceFill([
            'name' => 'Read Only User',
            'password' => env('SEED_ADMIN_PASSWORD', 'ChangeMe!2026'),
            'role' => UserRole::Viewer,
            'email_verified_at' => now(),
        ])->save();

        // พนักงานตัวอย่าง (role = viewer) สำหรับเลือกเป็นผู้ถือครอง
        if (User::count() < 10) {
            User::factory(40)->create();
        }

        $this->call(ItSystemSeeder::class); // สาขา + ผู้ใช้ตัวอย่างของฝ่าย IT (รันซ้ำได้)

        if (Location::exists()) {
            $this->call(AssetMovementSeeder::class); // เติมประวัติให้ข้อมูลเดิมที่ยังไม่มี
            return; // มีข้อมูลตัวอย่างแล้ว
        }

        // สาขา > อาคาร > ชั้น > ห้อง
        $hq = Location::create(['code' => 'HQ', 'name' => 'สำนักงานใหญ่', 'type' => 'site']);
        $rooms = collect();
        foreach (['A', 'B'] as $b) {
            $building = Location::create(['code' => "HQ-$b", 'name' => "อาคาร $b", 'type' => 'building', 'parent_id' => $hq->id]);
            foreach ([1, 2, 3] as $f) {
                $floor = Location::create(['code' => "HQ-$b-F$f", 'name' => "อาคาร $b ชั้น $f", 'type' => 'floor', 'parent_id' => $building->id]);
                foreach ([1, 2] as $r) {
                    $rooms->push(Location::create([
                        'code' => "HQ-$b-{$f}0$r",
                        'name' => "ห้อง $b{$f}0$r",
                        'type' => 'room',
                        'parent_id' => $floor->id,
                    ]));
                }
            }
        }
        $rooms->push(Location::create(['code' => 'WH-01', 'name' => 'คลังพัสดุกลาง', 'type' => 'warehouse', 'parent_id' => $hq->id]));

        Asset::factory(300)
            ->state(fn () => [
                'location_id' => $rooms->random()->id,
                'custodian_id' => fake()->boolean(60) ? $admin->id : null,
                'created_by' => $admin->id,
            ])
            ->create();

        $this->call(AssetMovementSeeder::class);
    }
}
