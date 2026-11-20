// QuillBot session export for TopRated OneClick.
// Run in the DevTools Console on https://quillbot.com while signed in, then run
// copy(trstQuillBotSession) and paste into Admin -> Tools -> QuillBot -> session.
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
    console.log("No QuillBot sign-in found in this browser. Sign in to quillbot.com first, then run this again.");
    return;
  }
  const cookieToken = (document.cookie.split("; ").find((c) => c.startsWith("useridtoken=")) || "").slice("useridtoken=".length);
  window.trstQuillBotSession = JSON.stringify({
    source: "trst-quillbot-export",
    version: 1,
    cookie: document.cookie,
    useridtoken: cookieToken ? decodeURIComponent(cookieToken) : record.value.stsTokenManager.accessToken,
    firebase_auth: JSON.stringify(record),
  });
  // copy() is unavailable after an await, and prompt() truncates long text,
  // so copying is a separate step.
  console.log("Ready (" + window.trstQuillBotSession.length + " characters). Now run:  copy(trstQuillBotSession)");
})();
