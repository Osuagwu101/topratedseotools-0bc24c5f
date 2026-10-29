<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= isset($pageTitle) ? e($pageTitle) . ' — ' : '' ?>Top Rated SEO Tools Admin</title>
<?php include __DIR__ . '/favicon.php'; ?>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
<style type="text/tailwindcss">
  @custom-variant dark (&:where(.dark, .dark *));
</style>
<script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.x.x/dist/cdn.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
  // Apply saved theme before paint, avoids a light->dark flash.
  try {
    if (localStorage.getItem('oc_theme') === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
</script>
<style>
  :root {
    --oc-primary: #1e4e8c;
    --oc-primary-end: #3f7fd1;
    --oc-accent: #eaf1fc;
    --oc-warning: #f5b400;
    --oc-success: #16a34a;
    --oc-destructive: #dc2626;
  }
  body { font-family: 'Inter', sans-serif; }
  .oc-gradient { background: linear-gradient(135deg, var(--oc-primary), var(--oc-primary-end)); }
  .oc-glow { box-shadow: 0 0 24px rgba(30, 78, 140, 0.25); }
</style>
</head>
<body class="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 min-h-screen" x-data="{ sidebarOpen: false }">
<div class="flex min-h-screen">
  <?php include __DIR__ . '/sidebar.php'; ?>
  <div class="flex-1 flex flex-col min-w-0">
    <header class="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4">
      <button class="md:hidden" @click="sidebarOpen = !sidebarOpen" aria-label="Toggle menu">☰</button>
      <h1 class="text-lg font-semibold"><?= e($pageTitle ?? 'Dashboard') ?></h1>
      <?php include __DIR__ . '/theme-toggle.php'; ?>
    </header>
    <main class="flex-1 p-6">
      <?php $flash = oc_flash_take(); ?>
      <?php if ($flash): ?>
        <div class="mb-4 rounded-lg px-4 py-3 text-sm <?= $flash['type'] === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' ?>">
          <?= e($flash['message']) ?>
        </div>
      <?php endif; ?>
