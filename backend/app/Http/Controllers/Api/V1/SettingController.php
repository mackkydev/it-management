<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Models\AppSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * 5.2 ตั้งค่าการแจ้งเตือน (admin)
 *   contract_notify_days   — แจ้งเตือนสัญญาล่วงหน้ากี่วัน (ค่าเริ่มต้น)
 *   credential_notify_days — แจ้งเตือนบัญชี/รหัสใกล้หมดอายุล่วงหน้ากี่วัน
 *   notify_emails          — อีเมลรับแจ้งเตือน (หลายอีเมล)
 */
class SettingController extends Controller
{
    /** กลุ่มผู้ใช้ในหน้าสิทธิ์การใช้งาน (frontend: lib/permissions.ts) */
    private const UI_AUDIENCES = ['admin', 'manager', 'viewer', 'it_staff', 'it_head'];

    /** GET /ui-config — การมองเห็นเมนู/ปุ่ม + ลำดับเมนู (ทุกคนที่ login อ่านได้ ใช้สร้างเมนู) */
    public function uiConfig(): JsonResponse
    {
        $s = AppSetting::allValues();

        return response()->json(['data' => ['ui_permissions' => $s['ui_permissions'], 'menu_order' => $s['menu_order']]]);
    }

    public function show(): JsonResponse
    {
        Gate::authorize('admin');

        return response()->json(['data' => AppSetting::allValues()]);
    }

    public function update(Request $request): JsonResponse
    {
        Gate::authorize('admin');

        $data = $request->validate([
            'contract_notify_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'credential_notify_days' => ['sometimes', 'integer', 'min:1', 'max:365'],
            'notify_emails' => ['sometimes', 'array', 'max:20'],
            'notify_emails.*' => ['required', 'email:rfc', 'max:255', 'distinct:ignore_case'],
            'ticket_other_types' => ['sometimes', 'array', 'max:30'],
            'ticket_other_types.*' => ['required', 'string', 'max:100', 'distinct'],
            // สิทธิ์การมองเห็นเมนู/ปุ่ม: { "<key>": ["viewer", ...] }
            'ui_permissions' => ['sometimes', 'array', 'max:200'],
            'ui_permissions.*' => ['array'],
            'ui_permissions.*.*' => ['in:'.implode(',', self::UI_AUDIENCES)],
            // ลำดับเมนู: { groups: [...], items: { "<groupId>": ["/href", ...] } }
            'menu_order' => ['sometimes', 'array'],
            'menu_order.groups' => ['sometimes', 'array', 'max:50'],
            'menu_order.groups.*' => ['string', 'max:50'],
            'menu_order.items' => ['sometimes', 'array', 'max:50'],
            'menu_order.items.*' => ['array', 'max:100'],
            'menu_order.items.*.*' => ['string', 'max:100'],
        ]);
        if (isset($data['ticket_other_types'])) {
            $data['ticket_other_types'] = array_values(array_unique(array_map('trim', $data['ticket_other_types'])));
        }

        if (isset($data['notify_emails'])) {
            $data['notify_emails'] = array_values(array_unique(array_map('strtolower', $data['notify_emails'])));
        }
        foreach ($data as $key => $value) {
            AppSetting::put($key, $value, $request->user()->id);
        }

        return response()->json(['data' => AppSetting::allValues()]);
    }
}
