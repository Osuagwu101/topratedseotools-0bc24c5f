// QuillBot session export for TopRated OneClick.
// Run in the DevTools Console on https://quillbot.com while signed in, then
// paste the copied JSON into Admin -> Tools -> QuillBot -> session.
// It copies your QuillBot cookies plus the Firebase sign-in record (which holds
// the refresh token), so the server can keep QuillBot signed in.
// Keep the result private: it is a login for your QuillBot account.
(async () => {
  const readIndexedDB = () => new Promise((resolve) => {
    const req = indexedDB.open("firebaseLocalStorageDb");
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("firebaseLocalStorage")) { db.close(); resolve(null); return; }
      const all = db.transaction("firebaseLocalStorage", "readonly").objectStore("firebaseLocalStorage").getAll();
      all.onsuccess = () => {
        db.close();
        const row = (all.result || []).find((r) => String(r.fbase_key).startsWith("firebase:authUser:"));
        resolve(row ? { store: "indexedDB", key: row.fbase_key, value: row.value } : null);
      };
      all.onerror = () => { db.close(); resolve(null); };
    };
  });
  let record = await readIndexedDB();
  if (!record) {
    const key = Object.keys(localStorage).find((k) => k.startsWith("firebase:authUser:"));
    if (key) record = { store: "localStorage", key, value: JSON.parse(localStorage.getItem(key)) };
  }
  if (!record || !record.value?.stsTokenManager?.refreshToken) {
    alert("No QuillBot sign-in found in this browser. Sign in to quillbot.com first, then run this again.");
    return;
  }
  const cookieToken = (document.cookie.split("; ").find((c) => c.startsWith("useridtoken=")) || "").slice("useridtoken=".length);
  const out = JSON.stringify({
    source: "trst-quillbot-export",
    version: 1,
    cookie: document.cookie,
    useridtoken: cookieToken ? decodeURIComponent(cookieToken) : record.value.stsTokenManager.accessToken,
    firebase_auth: JSON.stringify(record),
  });
  try { copy(out); console.log("QuillBot session copied to clipboard. Paste it into Admin."); }
  catch { prompt("Copy this QuillBot session and paste it into Admin:", out); }
})();
