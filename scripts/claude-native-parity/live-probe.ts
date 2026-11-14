import { testClaudeUpstream } from "../../src/lib/claude-proxy.server";
const request = new Request("https://claude.topratedseotools.com/new", {
  headers: {
    Accept: "text/html",
    "Accept-Language": "en-US,en;q=0.9",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    Referer: "https://claude.topratedseotools.com/new",
  },
});
console.log(JSON.stringify(await testClaudeUpstream(request)));
