<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\Branch;
use App\Models\User;
use Illuminate\Database\Seeder;

/**
 * ข้อมูลตั้งต้นของ IT-SYSTEM (รันซ้ำได้)
 *   - สาขาตามแบบฟอร์ม "ใบแจ้งดำเนินงาน IT"
 *   - ผู้ใช้ตัวอย่าง: หัวหน้า IT, เจ้าหน้าที่ IT, หัวหน้าแผนก + พนักงาน (สายบังคับบัญชา)
 *   php artisan db:seed --class=ItSystemSeeder
 */
class ItSystemSeeder extends Seeder
{
    private const BRANCHES = [
        ['BKK', 'กรุงเทพ'],
        ['SRB', 'สระบุรี'],
        ['SKT', 'สุโขทัย'],
        ['BRM', 'บุรีรัมย์'],
        ['UBN', 'อุบลราชธานี'],
        ['KKN', 'ขอนแก่น'],
        ['LPN', 'ลำพูน'],
        ['CBI', 'ชลบุรี'],
        ['PBT', 'พระพุทธบาท'],
        ['NMA', 'นครราชสีมา'],
    ];

    public function run(): void
    {
        foreach (self::BRANCHES as $i => [$code, $name]) {
            Branch::withTrashed()->updateOrCreate(['code' => $code], ['name' => $name, 'sort_order' => ($i + 1) * 10, 'is_active' => true]);
        }
        $bkk = Branch::where('code', 'BKK')->first();
        $kkn = Branch::where('code', 'KKN')->first();
        $password = env('SEED_ADMIN_PASSWORD', 'ChangeMe!2026');

        $make = function (string $email, array $attrs) use ($password): User {
            $u = User::firstOrNew(['email' => $email]);
            $u->forceFill(['password' => $u->exists ? $u->password : $password, 'email_verified_at' => now(), ...$attrs])->save();

            return $u;
        };

        User::where('email', 'admin@example.com')->first()?->forceFill([
            'branch_id' => $bkk->id, 'department' => 'IT', 'division' => 'เทคโนโลยีสารสนเทศ',
        ])->save();

        $itHead = $make('it.head@example.com', [
            'name' => 'IT Manager', 'role' => UserRole::Manager, 'branch_id' => $bkk->id,
            'department' => 'IT', 'division' => 'เทคโนโลยีสารสนเทศ', 'is_it_head' => true, 'is_it_staff' => true,
        ]);
        $make('it.staff@example.com', [
            'name' => 'IT Support', 'role' => UserRole::Manager, 'branch_id' => $bkk->id,
            'department' => 'IT', 'division' => 'เทคโนโลยีสารสนเทศ', 'is_it_staff' => true, 'supervisor_id' => $itHead->id,
        ]);
        $chief = $make('chief@example.com', [
            'name' => 'Sales Manager', 'role' => UserRole::Viewer, 'branch_id' => $kkn->id,
            'department' => 'ขาย', 'division' => 'ขาย',
        ]);
        $make('staff@example.com', [
            'name' => 'Sales Staff', 'role' => UserRole::Viewer, 'branch_id' => $kkn->id,
            'department' => 'ขาย', 'division' => 'ขาย', 'supervisor_id' => $chief->id,
        ]);
    }
}
