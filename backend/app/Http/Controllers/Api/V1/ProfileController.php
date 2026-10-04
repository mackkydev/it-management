<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\UserResource;
use App\Services\TicketFiles;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * ข้อมูลส่วนตัวของผู้ใช้ที่ login อยู่ (role/สถานะบัญชีแก้ที่นี่ไม่ได้)
 */
class ProfileController extends Controller
{
    /** PATCH /api/v1/auth/me */
    public function update(Request $request): UserResource
    {
        $user = $request->user();

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'string', 'email', 'max:255', Rule::unique('users', 'email')->ignore($user->id)],
        ]);

        if (isset($data['email'])) {
            $data['email'] = strtolower($data['email']);
        }

        $user->fill($data)->save();

        return UserResource::make($user);
    }

    /** GET /api/v1/auth/me/signature — รูปลายเซ็นของตัวเอง */
    public function signature(Request $request, TicketFiles $files)
    {
        $path = $request->user()->signature_path;
        abort_unless($path, 404);

        return $files->response($path);
    }

    /** POST /api/v1/auth/me/signature (multipart: signature) — PNG/JPG/WebP ≤ 1MB แทนที่ของเดิม */
    public function uploadSignature(Request $request, TicketFiles $files): UserResource
    {
        $request->validate(['signature' => ['required', 'image', 'mimes:png,jpg,jpeg,webp', 'max:1024']]);

        $user = $request->user();
        $old = $user->signature_path;
        $user->forceFill(['signature_path' => $files->storeUserSignature($user->id, $request->file('signature'))])->save();
        $files->delete($old);

        return UserResource::make($user);
    }

    /** DELETE /api/v1/auth/me/signature — ใบงานที่ส่งไปแล้วยังมีสำเนาของตัวเอง */
    public function deleteSignature(Request $request, TicketFiles $files): Response
    {
        $user = $request->user();
        $old = $user->signature_path;
        $user->forceFill(['signature_path' => null])->save();
        $files->delete($old);

        return response()->noContent();
    }

    /** PUT /api/v1/auth/password — เปลี่ยนรหัสผ่าน แล้วเพิกถอน token ของอุปกรณ์อื่นทั้งหมด */
    public function updatePassword(Request $request): Response
    {
        $request->validate([
            'current_password' => ['required', 'string', 'current_password:sanctum'],
            'password' => ['required', 'string', 'confirmed', 'different:current_password', Password::min(8)->letters()->numbers()],
        ]);

        $user = $request->user();
        $user->forceFill(['password' => $request->input('password')])->save();

        $current = $user->currentAccessToken();
        $user->tokens()->when($current?->id, fn ($q, $id) => $q->whereKeyNot($id))->delete();

        return response()->noContent();
    }
}
