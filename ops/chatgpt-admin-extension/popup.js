const SESSION = "__Secure-next-auth.session-token";
const CHUNK_PREFIX = SESSION + ".";
const SUPPORTING = [
  "__Host-next-auth.csrf-token",
  "__Secure-next-auth.callback-url",
  "__Secure-oai-is",
  "_account",
  "_puid",
  "_uasid",
  "_umsid",
  "oai-did",
  "oai-sc",
  "oai_client_auth_info",
  "oai-client-auth-info",
  "oai-client-session-epoch",
  "oai-hlib",
  "__oailb",
];

function setOverall(ok, message, detail = "") {
  const el = document.getElementById("overall");
  el.textContent = message;
  el.className = "status " + (ok ? "good" : "bad");
  document.getElementById("session-detail").textContent = detail;
}

function renderList(names) {
  const ul = document.getElementById("cookie-list");
  ul.textContent = "";
  const approved = [SESSION, ...SUPPORTING];
  for (const name of approved) {
    const li = document.createElement("li");
    li.textContent = (names.has(name) ? "✓ " : "– ") + name;
    ul.appendChild(li);
  }
  const chunkNames = [...names]
    .filter(name => name.startsWith(CHUNK_PREFIX))
    .sort((a, b) => Number(a.slice(CHUNK_PREFIX.length)) - Number(b.slice(CHUNK_PREFIX.length)));
  for (const name of chunkNames) {
    const li = document.createElement("li");
    li.textContent = "✓ " + name;
    ul.insertBefore(li, ul.firstChild);
  }
}

function checkTokenStructure(names) {
  if (names.has(SESSION)) {
    const hasChunks = [...names].some(name => name.startsWith(CHUNK_PREFIX));
    return hasChunks
      ? { ok: false, detail: "Both unchunked and chunked session tokens are present." }
      : { ok: true, detail: "Unchunked session token detected." };
  }

  const indexes = [...names]
    .filter(name => name.startsWith(CHUNK_PREFIX))
    .map(name => Number(name.slice(CHUNK_PREFIX.length)))
    .filter(Number.isInteger)
    .sort((a, b) => a - b);

  if (indexes.length < 2 || indexes[0] !== 0) {
    return { ok: false, detail: "Complete .0, .1, ... session-token chunks were not found." };
  }

  for (let i = 0; i < indexes.length; i++) {
    if (indexes[i] !== i) {
      return { ok: false, detail: "Session-token chunks contain a gap." };
    }
  }
  return { ok: true, detail: "Complete chunked session token detected: ." + indexes.join(", .") };
}


async function renderObserved() {
  const box = document.getElementById("observed");
  const observed = (await chrome.storage.session.get("observed")).observed || {};
  const rows = [];
  for (const key of ["user","me","init"]) {
    const item = observed[key];
    if (!item) continue;
    rows.push(
      key + ": " +
      (item.names.length ? item.names.join(", ") : "no Cookie header names visible")
    );
  }
  box.textContent = rows.length
    ? rows.join("\n")
    : "No matching requests observed yet. Refresh chatgpt.com, then check again.";
}

async function runCheck() {
  setOverall(false, "Checking…");
  try {
    const cookies = await chrome.cookies.getAll({ domain: "chatgpt.com" });
    const names = new Set(cookies.map(cookie => cookie.name));
    renderList(names);

    await renderObserved();

    const token = checkTokenStructure(names);
    const supportingCount = SUPPORTING.filter(name => names.has(name)).length;

    if (!token.ok) {
      setOverall(false, "Session structure incomplete", token.detail);
      return;
    }

    setOverall(
      true,
      "Session structure looks complete",
      token.detail + " Supporting approved cookies found: " + supportingCount + "."
    );
  } catch (error) {
    setOverall(false, "Could not inspect ChatGPT cookies", String(error?.message || error));
  }
}

document.getElementById("refresh").addEventListener("click", runCheck);
document.getElementById("open-admin").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://topratedseotools.com/admin/tools/chatgpt" });
});
runCheck();
