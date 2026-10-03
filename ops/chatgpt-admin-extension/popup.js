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
const APPROVED = new Set([SESSION, ...SUPPORTING]);

function isApproved(name) {
  return APPROVED.has(name) || /^__Secure-next-auth\.session-token\.\d+$/.test(name);
}

function sessionNames(names) {
  if (names.has(SESSION)) return [SESSION];
  return [...names]
    .filter(name => name.startsWith(CHUNK_PREFIX))
    .sort((a,b) =>
      Number(a.slice(CHUNK_PREFIX.length)) - Number(b.slice(CHUNK_PREFIX.length))
    );
}

function checkTokenStructure(names) {
  if (names.has(SESSION)) {
    const hasChunks = [...names].some(name => name.startsWith(CHUNK_PREFIX));
    return hasChunks
      ? { ok:false, detail:"Both unchunked and chunked session tokens are present." }
      : { ok:true, detail:"Unchunked session token detected." };
  }
  const indexes = [...names]
    .filter(name => name.startsWith(CHUNK_PREFIX))
    .map(name => Number(name.slice(CHUNK_PREFIX.length)))
    .filter(Number.isInteger)
    .sort((a,b) => a-b);
  if (indexes.length < 2 || indexes[0] !== 0) {
    return { ok:false, detail:"Complete .0, .1, ... session-token chunks were not found." };
  }
  for (let i=0;i<indexes.length;i++) {
    if (indexes[i] !== i) return { ok:false, detail:"Session-token chunks contain a gap." };
  }
  return { ok:true, detail:"Complete chunked session token detected: ." + indexes.join(", .") };
}

function setOverall(ok, message, detail="") {
  const el=document.getElementById("overall");
  el.textContent=message;
  el.className="status " + (ok ? "good" : "bad");
  document.getElementById("session-detail").textContent=detail;
}

function renderList(names) {
  const ul=document.getElementById("cookie-list");
  ul.textContent="";
  for (const name of [...sessionNames(names), ...SUPPORTING]) {
    const li=document.createElement("li");
    li.textContent=(names.has(name) ? "✓ " : "– ") + name;
    ul.appendChild(li);
  }
}

function approvedSet(values) {
  return new Set((values || []).filter(isApproved));
}

function intersection(sets) {
  if (!sets.length) return new Set();
  const [first,...rest]=sets;
  return new Set([...first].filter(name => rest.every(set => set.has(name))));
}

async function buildCandidate() {
  const observed=(await chrome.storage.session.get("observed")).observed || {};
  const keys=["user","me","init"].filter(key => observed[key]);
  const requestSets=keys.map(key => approvedSet(observed[key].names));
  const union=new Set(requestSets.flatMap(set => [...set]));
  const common=intersection(requestSets);

  const browserCookies=await chrome.cookies.getAll({domain:"chatgpt.com"});
  const browserNames=new Set(browserCookies.map(cookie => cookie.name));
  const core=sessionNames(browserNames);

  const supportCommon=[...common]
    .filter(name => !core.includes(name) && SUPPORTING.includes(name))
    .sort();
  const optional=[...union]
    .filter(name => !core.includes(name) && SUPPORTING.includes(name) && !supportCommon.includes(name))
    .sort();

  return {observed, keys, core, supportCommon, optional};
}

async function renderObservedAndCandidate() {
  const result=await buildCandidate();
  const observedBox=document.getElementById("observed");
  const candidateBox=document.getElementById("candidate");

  const rows=[];
  for (const key of ["user","me","init"]) {
    const item=result.observed[key];
    if (!item) continue;
    const approved=(item.names || []).filter(isApproved);
    rows.push(key + ": " + (approved.length ? approved.join(", ") : "no approved cookie names observed"));
  }
  observedBox.textContent=rows.length
    ? rows.join("\n")
    : "No matching authenticated requests observed yet. Click Observe now.";

  if (!result.keys.length) {
    candidateBox.textContent="Observe ChatGPT first.";
  } else {
    const parts=[
      "Core: " + (result.core.join(", ") || "not detected"),
      "Common supporting: " + (result.supportCommon.join(", ") || "none"),
      "Additional observed: " + (result.optional.join(", ") || "none"),
      "Observed targets: " + result.keys.join(", "),
    ];
    candidateBox.textContent=parts.join("\n");
  }
  return result;
}

async function runCheck() {
  setOverall(false,"Checking…");
  try {
    const cookies=await chrome.cookies.getAll({domain:"chatgpt.com"});
    const names=new Set(cookies.map(cookie => cookie.name));
    renderList(names);
    await renderObservedAndCandidate();
    const token=checkTokenStructure(names);
    const supportingCount=SUPPORTING.filter(name => names.has(name)).length;
    if (!token.ok) {
      setOverall(false,"Session structure incomplete",token.detail);
      return;
    }
    setOverall(
      true,
      "Session structure looks complete",
      token.detail + " Supporting approved cookies found: " + supportingCount + "."
    );
  } catch (error) {
    setOverall(false,"Could not inspect ChatGPT cookies",String(error?.message || error));
  }
}

async function observeNow() {
  await chrome.storage.session.remove("observed");
  const tabs=await chrome.tabs.query({url:["https://chatgpt.com/*"]});
  if (!tabs.length) {
    await chrome.tabs.create({url:"https://chatgpt.com/"});
    document.getElementById("candidate").textContent=
      "Opened ChatGPT. Make sure you are signed in, then click Observe now again.";
    return;
  }
  const tab=tabs.find(t => t.active) || tabs[0];
  if (tab.id != null) {
    await chrome.tabs.reload(tab.id,{bypassCache:false});
    document.getElementById("candidate").textContent=
      "Reloaded ChatGPT. Wait about 8 seconds, then click Check again.";
  }
}

async function configureAdmin() {
  const result=await buildCandidate();
  if (!result.core.length) {
    setOverall(false,"Cannot configure Admin","No complete ChatGPT session-token structure is available.");
    return;
  }
  if (!result.keys.length) {
    setOverall(false,"Observe ChatGPT first","Click Observe now, wait for ChatGPT to reload, then Check again.");
    return;
  }

  const url=new URL("https://topratedseotools.com/admin/tools/chatgpt");
  url.searchParams.set("tab","session");
  url.searchParams.set("cg_core",result.core.join(","));
  if (result.supportCommon.length) {
    url.searchParams.set("cg_support",result.supportCommon.join(","));
  }
  if (result.optional.length) {
    url.searchParams.set("cg_optional",result.optional.join(","));
  }
  url.searchParams.set("cg_observed",result.keys.join(","));
  await chrome.tabs.create({url:url.toString()});
}

document.getElementById("observe").addEventListener("click",observeNow);
document.getElementById("refresh").addEventListener("click",runCheck);
document.getElementById("configure-admin").addEventListener("click",configureAdmin);
document.getElementById("clear").addEventListener("click",async () => {
  await chrome.storage.session.remove("observed");
  await runCheck();
});
runCheck();
