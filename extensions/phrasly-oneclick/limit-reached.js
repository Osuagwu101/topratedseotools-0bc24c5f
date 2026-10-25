const value = Number(new URLSearchParams(location.search).get("resets_in"));
const seconds = Number.isSafeInteger(value) && value >= 0 && value <= 86400 ? value : 0;
document.getElementById("resetsIn").textContent = seconds ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m` : "soon";
