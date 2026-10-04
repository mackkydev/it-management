<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * แจ้งเตือนในระบบ (กระดิ่ง) ของผู้ใช้ที่ login อยู่
 * GET  /notifications?unread=1&per_page=   (+ unread_count)
 * POST /notifications/{id}/read
 * POST /notifications/read-all
 */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $f = $request->validate([
            'unread' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:50'],
        ]);
        $u = $request->user();

        $page = ($request->boolean('unread') ? $u->unreadNotifications() : $u->notifications())
            ->paginate($f['per_page'] ?? 15);

        return response()->json([
            'data' => $page->getCollection()->map(fn ($n) => [
                'id' => $n->id,
                'data' => $n->data,
                'read_at' => $n->read_at?->toIso8601String(),
                'created_at' => $n->created_at->toIso8601String(),
            ]),
            'unread_count' => $u->unreadNotifications()->count(),
            'meta' => ['current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total()],
        ]);
    }

    public function read(Request $request, string $id): Response
    {
        $request->user()->notifications()->whereKey($id)->update(['read_at' => now()]);

        return response()->noContent();
    }

    public function readAll(Request $request): Response
    {
        $request->user()->unreadNotifications()->update(['read_at' => now()]);

        return response()->noContent();
    }
}
