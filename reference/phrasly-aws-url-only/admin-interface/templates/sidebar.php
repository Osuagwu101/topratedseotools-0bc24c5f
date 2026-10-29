<?php $current = basename($_SERVER['SCRIPT_NAME']); ?>
<aside
  class="w-64 shrink-0 border-r border-slate-200 dark:border-slate-700 p-4 flex flex-col"
  :class="sidebarOpen ? 'block' : 'hidden md:flex'"
>
  <div class="flex items-center gap-2 rounded-xl px-3 py-3 mb-6 border border-slate-200 dark:border-slate-700">
    <img src="/assets/img/logo-64.webp" alt="" class="h-8 w-8 rounded-md">
    <span class="font-bold text-sm leading-tight">Top Rated<br>SEO Tools</span>
  </div>
  <nav class="flex flex-col gap-1 text-sm">
    <?php
    $links = [
        'dashboard.php' => '📊 Overview',
        'users.php'     => '👤 Users',
        'tools.php'     => '🧰 Tools',
        'tool-vault.php' => '🔐 Tool Vault',
        'cookie-tools.php' => '🍪 Cookie-Based Tools',
        'activity.php'  => '📜 Activity Log',
        'profile.php'   => '⚙️ My Profile',
    ];
    foreach ($links as $href => $label):
        $active = $current === $href;
    ?>
      <a href="/<?= e($href) ?>"
         class="rounded-md px-3 py-2 <?= $active ? 'oc-gradient text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800' ?>">
        <?= $label ?>
      </a>
    <?php endforeach; ?>
  </nav>
  <div class="mt-auto pt-4">
    <a href="/logout.php" class="block rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950">🚪 Logout</a>
  </div>
</aside>
