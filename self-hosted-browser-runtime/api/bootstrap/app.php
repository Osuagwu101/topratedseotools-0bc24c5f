<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Phase 1: no production integration middleware yet.
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // Phase 1: use Laravel defaults; structured error policy arrives later.
    })
    ->create();
