function fmtCountdown(seconds) {
  const s = parseInt(seconds, 10);
  if (!s || s <= 0) return 'soon';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const params = new URLSearchParams(window.location.search);
document.getElementById('resetsIn').textContent = fmtCountdown(params.get('resets_in'));
