<?php

use Illuminate\Support\Facades\Route;

Route::get('/health', static function () {
    return response()->json([
        'status' => 'ok',
        'service' => 'control-plane',
        'phase' => 2,
        'browser_core' => 'generic',
    ]);
});
