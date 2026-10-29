<?php
require_once __DIR__ . '/../src/auth.php';
require_once __DIR__ . '/../src/helpers.php';
oc_require_admin();

$db = oc_db();

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    oc_csrf_check();
    $action = $_POST['action'] ?? '';

    if ($action === 'add_account') {
        $toolId = (int) $_POST['tool_id'];
        $label = trim($_POST['label'] ?? '');
        $targetUrl = trim($_POST['target_url'] ?? '');
        $cookieJsonRaw = trim($_POST['cookie_json'] ?? '');
        $capacityRaw = trim($_POST['capacity'] ?? '');
        $capacity = $capacityRaw === '' ? null : max(1, (int) $capacityRaw);

        if ($targetUrl === '' || $cookieJsonRaw === '') {
            oc_flash_set('URL and cookies are both required.', 'error');
            oc_redirect('/cookie-tools.php');
        }
        $decoded = json_decode($cookieJsonRaw, true);
        if (!is_array($decoded)) {
            oc_flash_set('Cookies must be valid JSON (an array of cookie objects).', 'error');
            oc_redirect('/cookie-tools.php');
        }

        $db->prepare('INSERT INTO tool_cookie_accounts (tool_id, label, target_url, cookie_json, capacity, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))')
            ->execute([$toolId, $label, $targetUrl, json_encode($decoded), $capacity]);
        oc_log('admin', oc_current_admin_id(), 'cookie_account_added', (string) $toolId);
        oc_flash_set('Account added.');
        oc_redirect('/cookie-tools.php');
    }

    if ($action === 'update_account') {
        $accountId = (int) $_POST['account_id'];
        $label = trim($_POST['label'] ?? '');
        $targetUrl = trim($_POST['target_url'] ?? '');
        $cookieJsonRaw = trim($_POST['cookie_json'] ?? '');
        $capacityRaw = trim($_POST['capacity'] ?? '');
        $capacity = $capacityRaw === '' ? null : max(1, (int) $capacityRaw);

        if ($targetUrl === '' || $cookieJsonRaw === '') {
            oc_flash_set('URL and cookies are both required.', 'error');
            oc_redirect('/cookie-tools.php');
        }
        $decoded = json_decode($cookieJsonRaw, true);
        if (!is_array($decoded)) {
            oc_flash_set('Cookies must be valid JSON (an array of cookie objects).', 'error');
            oc_redirect('/cookie-tools.php');
        }

        $db->prepare("UPDATE tool_cookie_accounts SET label=?, target_url=?, cookie_json=?, capacity=?, updated_at=datetime('now') WHERE id=?")
            ->execute([$label, $targetUrl, json_encode($decoded), $capacity, $accountId]);
        oc_log('admin', oc_current_admin_id(), 'cookie_account_updated', (string) $accountId);
        oc_flash_set('Account updated.');
        oc_redirect('/cookie-tools.php');
    }

    if ($action === 'delete_account') {
        $accountId = (int) $_POST['account_id'];
        $inUse = $db->prepare('SELECT COUNT(*) FROM cookie_account_assignments WHERE account_id = ?');
        $inUse->execute([$accountId]);
        if ((int) $inUse->fetchColumn() > 0) {
            oc_flash_set('Can\'t remove an account that\'s already assigned to a customer.', 'error');
        } else {
            $db->prepare('DELETE FROM tool_cookie_accounts WHERE id = ?')->execute([$accountId]);
            oc_flash_set('Account removed.');
        }
        oc_redirect('/cookie-tools.php');
    }
}

$tools = $db->query("SELECT * FROM tools WHERE fulfillment_type = 'cookie_extension' ORDER BY display_name")->fetchAll(PDO::FETCH_ASSOC);
$csrf = oc_csrf_token();
$pageTitle = 'Cookie-Based Tools';
require __DIR__ . '/../templates/header.php';
?>

<p class="text-sm text-slate-500 dark:text-slate-400 mb-6">
  Cookie-based tools (the browser-extension model, not the reverse-proxy
  engine Stealth Writer uses — see <code>phrasly-oneclick-postmortem.md</code>
  for why). Paste the real site's <strong>URL</strong> and an exported
  <strong>cookie JSON array</strong> (the usual <code>chrome.cookies.getAll</code>
  export shape: <code>domain</code>, <code>name</code>, <code>value</code>,
  <code>path</code>, <code>secure</code>, <code>httpOnly</code>,
  <code>expirationDate</code>, <code>sameSite</code>) per account. Same
  <strong>capacity</strong> pooling as the Tool Vault — blank is unlimited
  reuse, a number caps how many buyers share that one account before the
  next one takes over. Add a second account under the same tool to attach a
  second real account/server.
</p>

<?php foreach ($tools as $t):
  $stmt = $db->prepare(
    "SELECT tca.*, COUNT(caa.user_id) AS used
     FROM tool_cookie_accounts tca
     LEFT JOIN cookie_account_assignments caa ON caa.account_id = tca.id
     WHERE tca.tool_id = ?
     GROUP BY tca.id
     ORDER BY tca.id ASC"
  );
  $stmt->execute([$t['id']]);
  $accounts = $stmt->fetchAll(PDO::FETCH_ASSOC);
  $totalRoom = 0;
  $totalUsed = 0;
  $hasUnlimited = false;
  foreach ($accounts as $a) {
      $totalUsed += (int) $a['used'];
      if ($a['capacity'] === null) { $hasUnlimited = true; } else { $totalRoom += (int) $a['capacity']; }
  }
?>
  <div class="rounded-2xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 p-6 shadow-sm mb-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="font-semibold text-lg"><?= e($t['display_name']) ?></h2>
      <span class="text-sm text-slate-500">
        <?= $totalUsed ?> in use<?= $hasUnlimited ? ' (unlimited capacity)' : ' / ' . $totalRoom . ' capacity' ?>
      </span>
    </div>

    <div class="flex flex-col gap-3 mb-4">
      <?php foreach ($accounts as $a): $formId = 'oc-cookie-acct-' . $a['id']; ?>
        <div class="border-t border-slate-100 dark:border-slate-700 pt-3">
          <form id="<?= $formId ?>" method="post" class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_90px] gap-2 mb-2">
            <input type="hidden" name="csrf" value="<?= e($csrf) ?>">
            <input type="hidden" name="action" value="update_account">
            <input type="hidden" name="account_id" value="<?= $a['id'] ?>">
            <input name="label" placeholder="Label (e.g. Account 1)" value="<?= e($a['label']) ?>" class="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 text-sm">
            <input name="target_url" value="<?= e($a['target_url']) ?>" class="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 text-sm font-mono">
            <input name="capacity" type="number" min="1" placeholder="&infin;" value="<?= e($a['capacity'] !== null ? (string) $a['capacity'] : '') ?>" class="rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 text-sm">
          </form>
          <textarea form="<?= $formId ?>" name="cookie_json" rows="3" class="w-full rounded border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 font-mono text-xs mb-2" placeholder="Cookie JSON array"><?= e($a['cookie_json']) ?></textarea>
          <div class="flex items-center gap-3 text-xs text-slate-500">
            <span><?= (int) $a['used'] ?><?= $a['capacity'] !== null ? ' / ' . $a['capacity'] : '' ?> in use</span>
            <?php if ($a['capacity'] !== null && (int) $a['used'] >= (int) $a['capacity']): ?>
              <span class="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300 rounded-full px-2 py-0.5">Full</span>
            <?php endif; ?>
            <button form="<?= $formId ?>" class="text-blue-600 hover:underline">Save</button>
            <?php if ((int) $a['used'] === 0): ?>
              <form method="post" onsubmit="return confirm('Remove this unused account?')" class="inline">
                <input type="hidden" name="csrf" value="<?= e($csrf) ?>">
                <input type="hidden" name="action" value="delete_account">
                <input type="hidden" name="account_id" value="<?= $a['id'] ?>">
                <button class="text-red-600 hover:underline">Remove</button>
              </form>
            <?php endif; ?>
          </div>
        </div>
      <?php endforeach; ?>
      <?php if (!$accounts): ?>
        <div class="py-3 text-slate-500 text-sm">No accounts added yet.</div>
      <?php endif; ?>
    </div>

    <form method="post" class="grid grid-cols-1 gap-2">
      <input type="hidden" name="csrf" value="<?= e($csrf) ?>">
      <input type="hidden" name="action" value="add_account">
      <input type="hidden" name="tool_id" value="<?= $t['id'] ?>">
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_90px] gap-2">
        <input name="label" placeholder="Label (e.g. Account 1)" class="rounded-md border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-2 text-sm">
        <input name="target_url" placeholder="https://example.com/dashboard" required class="rounded-md border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-2 text-sm font-mono">
        <input name="capacity" type="number" min="1" placeholder="Capacity" class="rounded-md border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-2 text-sm">
      </div>
      <textarea name="cookie_json" rows="3" required class="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-transparent px-3 py-2 font-mono text-xs" placeholder="Paste exported cookie JSON array here"></textarea>
      <button class="rounded-md border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm w-fit">+ Add account</button>
    </form>
  </div>
<?php endforeach; ?>
<?php if (!$tools): ?>
  <div class="rounded-2xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 p-6 shadow-sm text-sm text-slate-500">
    No cookie-based tools yet. Add one with <code>fulfillment_type = 'cookie_extension'</code> in the Tools table, then it'll show up here.
  </div>
<?php endif; ?>

<?php require __DIR__ . '/../templates/footer.php'; ?>
