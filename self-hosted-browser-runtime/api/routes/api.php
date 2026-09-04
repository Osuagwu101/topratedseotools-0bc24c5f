<?php

use Illuminate\Support\Facades\Route;

Route::get('/health', static function () {
    return response()->json([
        'status' => 'ok',
        'service' => 'control-plane',
        'phase' => 3,
        'browser_core' => 'generic',
        'viewer_layer' => 'isolated',
    ]);
});
