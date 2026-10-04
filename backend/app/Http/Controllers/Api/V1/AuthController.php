<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Auth\LoginRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * ออก Bearer Token ด้วย Sanctum — ใช้ได้ทั้ง Next.js (เก็บใน httpOnly cookie ฝั่ง server)
 * และ Mobile App (เก็บใน Secure Storage ของอุปกรณ์)
 */
class AuthController extends Controller
{
    public function login(LoginRequest $request): JsonResponse
    {
        $user = User::where('email', $request->string('email')->lower()->toString())->first();

        // ใช้ข้อความเดียวกันทุกกรณี เพื่อไม่ให้เดาได้ว่ามีอีเมลนี้ในระบบหรือไม่
        if (! $user || ! $user->is_active || ! Hash::check($request->input('password'), $user->password)) {
            throw ValidationException::withMessages([
                'email' => [__('eam.auth.failed')],
            ]);
        }

        $expiresAt = now()->addMinutes((int) config('eam.token_ttl_minutes'));
        $token = $user->createToken($request->input('device_name'), ['*'], $expiresAt);

        return response()->json([
            'token' => $token->plainTextToken,
            'token_type' => 'Bearer',
            'expires_at' => $expiresAt->toIso8601String(),
            'user' => UserResource::make($user),
        ]);
    }

    public function me(Request $request): UserResource
    {
        // รวมสังกัด/หัวหน้า/สิทธิ์ IT — frontend ใช้เติมค่าเริ่มต้นในฟอร์มแจ้งงาน และแสดงเมนูตามสิทธิ์
        return UserResource::make($request->user()->load(['branch:id,name', 'supervisor:id,name']));
    }

    /** เพิกถอนเฉพาะ token ของอุปกรณ์ที่เรียก */
    public function logout(Request $request): Response
    {
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }
}
