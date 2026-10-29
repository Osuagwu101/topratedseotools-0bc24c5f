function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso.replace(' ', 'T') + 'Z').toLocaleDateString();
}

function fmtCountdown(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

async function handleAccess(payload, signature, btn, original) {
  btn.disabled = true;
  btn.textContent = '…';
  chrome.runtime.sendMessage({ type: 'trst_access', payload, signature }, (response) => {
    btn.disabled = false;
    if (!response || !response.ok) {
      btn.textContent = response && response.error === 'limit_reached' ? 'Limit reached' : 'Failed';
      setTimeout(() => { btn.textContent = original; }, 2000);
      return;
    }
    btn.textContent = original;
  });
}

function renderFeatureRow(toolId, resetsIn, f) {
  const row = document.createElement('div');
  row.className = 'tool';

  const left = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = f.label;
  left.appendChild(name);

  const status = document.createElement('div');
  status.className = 'status';
  status.textContent = f.maxed
    ? `${f.used} / ${f.limit} used — resets in ${fmtCountdown(resetsIn)}`
    : `${f.used} / ${f.limit} used today`;
  left.appendChild(status);
  row.appendChild(left);

  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  const original = 'Access';
  btn.textContent = original;
  if (f.maxed || !f.payload) {
    btn.disabled = true;
    btn.textContent = f.maxed ? 'Limit reached' : original;
  } else {
    btn.addEventListener('click', () => handleAccess(f.payload, f.signature, btn, original));
  }
  row.appendChild(btn);

  return row;
}

function renderSimpleTool(t) {
  const row = document.createElement('div');
  row.className = 'tool';

  const left = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = t.name;
  left.appendChild(name);
  if (!t.active) {
    const status = document.createElement('div');
    status.className = 'status';
    status.textContent = 'Coming soon';
    left.appendChild(status);
  }
  row.appendChild(left);

  const btn = document.createElement('button');
  btn.className = 'tool-btn';
  btn.textContent = t.type === 'credential_reveal' ? 'Dashboard' : 'Access';
  if (!t.active || !t.open_url) {
    btn.disabled = true;
  } else {
    btn.addEventListener('click', () => chrome.tabs.create({ url: t.open_url }));
  }
  row.appendChild(btn);

  return row;
}

function showSignedIn(data) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('signedIn').classList.remove('hidden');

  document.getElementById('fullName').textContent = data.full_name || data.email;
  document.getElementById('email').textContent = data.email;

  const subEl = document.getElementById('subStatus');
  if (data.subscription_end) {
    const expired = new Date(data.subscription_end.replace(' ', 'T') + 'Z') < new Date();
    subEl.textContent = (expired ? 'Expired ' : 'Active until ') + fmtDate(data.subscription_end);
    subEl.classList.add(expired ? 'expired' : 'active');
  } else {
    subEl.textContent = 'No active subscription';
    subEl.classList.add('expired');
  }

  const list = document.getElementById('toolsList');
  if (!data.tools || data.tools.length === 0) {
    document.getElementById('noTools').classList.remove('hidden');
    return;
  }

  data.tools.forEach((t) => {
    if (t.type === 'cookie_extension') {
      if (!t.features || t.features.length === 0) return;
      t.features.forEach((f) => list.appendChild(renderFeatureRow(t.id, t.resets_in, f)));
    } else {
      list.appendChild(renderSimpleTool(t));
    }
  });
}

function showSignedOut(reason) {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('signedOut').classList.remove('hidden');
  document.getElementById('debugReason').textContent = reason ? ('debug: ' + reason) : '';
}

chrome.runtime.sendMessage({ type: 'trst_whoami' }, (response) => {
  if (chrome.runtime.lastError) {
    showSignedOut('message error: ' + chrome.runtime.lastError.message);
    return;
  }
  if (!response || !response.ok) {
    showSignedOut((response && response.error) || 'no response');
    return;
  }
  showSignedIn(response);
});
