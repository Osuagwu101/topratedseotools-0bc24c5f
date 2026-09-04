import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const DEFAULT_TEST_URL = 'data:text/html,%3Ctitle%3EPhase%202%20Browser%20Test%3C/title%3E%3Ch1%3ESafe%20test%20page%3C/h1%3E';

export function validateNavigationUrl(value) {
  const raw = String(value || DEFAULT_TEST_URL).trim();
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Navigation URL is invalid.');
  }

  if (!['http:', 'https:', 'data:'].includes(parsed.protocol)) {
    throw new Error('Navigation URL must use http, https, or data.');
  }

  if (parsed.protocol === 'data:' && !raw.toLowerCase().startsWith('data:text/html')) {
    throw new Error('Only data:text/html URLs are allowed for data navigation.');
  }

  return raw;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readProcessState(pid) {
  try {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    return status.match(/^State:\s+([A-Z])/m)?.[1] || null;
  } catch {
    return null;
  }
}

function collectProcessTree(rootPid) {
  const parentMap = new Map();
  let entries = [];
  try {
    entries = readdirSync('/proc', { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => Number(entry.name));
  } catch {
    return [rootPid];
  }

  for (const pid of entries) {
    try {
      const status = readFileSync(`/proc/${pid}/status`, 'utf8');
      const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] || 0);
      if (!parentMap.has(parent)) parentMap.set(parent, []);
      parentMap.get(parent).push(pid);
    } catch {
      // Process may exit while /proc is being scanned.
    }
  }

  const result = [];
  const queue = [rootPid];
  const seen = new Set();
  while (queue.length) {
    const pid = queue.shift();
    if (seen.has(pid)) continue;
    seen.add(pid);
    result.push(pid);
    for (const child of parentMap.get(pid) || []) queue.push(child);
  }
  return result;
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
  }

  async connect(timeoutMs = 5000) {
    const socket = new WebSocket(this.webSocketUrl);
    this.socket = socket;

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket connection timed out.')), timeoutMs);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('CDP WebSocket connection failed.'));
      }, { once: true });
    });

    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || 'CDP command failed.'));
        else resolve(message.result || {});
        return;
      }

      if (message.method && this.eventWaiters.has(message.method)) {
        const waiters = this.eventWaiters.get(message.method);
        this.eventWaiters.delete(message.method);
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          waiter.resolve(message.params || {});
        }
      }
    });

    socket.addEventListener('close', () => {
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error('CDP connection closed.'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, timeoutMs = 5000) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP connection is not open.'));
    }

    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = this.eventWaiters.get(method) || [];
        this.eventWaiters.set(method, current.filter((item) => item.resolve !== resolve));
        reject(new Error(`CDP event timed out: ${method}`));
      }, timeoutMs);
      const waiters = this.eventWaiters.get(method) || [];
      waiters.push({ resolve, reject, timer });
      this.eventWaiters.set(method, waiters);
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // Best-effort disconnect during process shutdown.
    }
    this.socket = null;
  }
}

async function waitForDevToolsPort(userDataDir, processRef, timeoutMs = 10000) {
  const portFile = join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (processRef.exitCode !== null) {
      throw new Error(`Chromium exited before CDP became available (code ${processRef.exitCode}).`);
    }
    if (existsSync(portFile)) {
      const [portLine] = readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0) return port;
    }
    await sleep(50);
  }

  throw new Error('Chromium did not expose a CDP port in time.');
}

async function findPageTarget(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch (error) {
      lastError = error;
    }
    await sleep(50);
  }
  throw new Error(`No Chromium page target became available${lastError ? `: ${lastError.message}` : '.'}`);
}

async function waitForExit(processRef, timeoutMs) {
  if (processRef.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    processRef.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export class BrowserSessionController {
  constructor({ executablePath = process.env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium' } = {}) {
    this.executablePath = executablePath;
    this.current = null;
  }

  get status() {
    if (!this.current) return { active: false, phase: 2 };
    return {
      active: true,
      phase: 2,
      sessionId: this.current.sessionId,
      pid: this.current.process.pid,
      url: this.current.url,
      title: this.current.title,
    };
  }

  async start(url = DEFAULT_TEST_URL) {
    if (this.current) throw Object.assign(new Error('A browser session is already active.'), { statusCode: 409 });
    if (!existsSync(this.executablePath)) throw new Error(`Chromium executable not found: ${this.executablePath}`);

    const safeUrl = validateNavigationUrl(url);
    const userDataDir = mkdtempSync(join(tmpdir(), 'toprated-browser-'));
    const browserProcess = spawn(this.executablePath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-crash-reporter',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    let stderr = '';
    browserProcess.stderr?.on('data', (chunk) => {
      if (stderr.length < 12000) stderr += String(chunk);
    });

    try {
      const port = await waitForDevToolsPort(userDataDir, browserProcess);
      const target = await findPageTarget(port);
      const cdp = new CdpClient(target.webSocketDebuggerUrl);
      await cdp.connect();
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');

      this.current = {
        sessionId: randomUUID(),
        process: browserProcess,
        userDataDir,
        port,
        cdp,
        url: 'about:blank',
        title: '',
      };

      await this.navigate(safeUrl);
      return this.status;
    } catch (error) {
      try { browserProcess.kill('SIGKILL'); } catch {}
      await waitForExit(browserProcess, 2000);
      rmSync(userDataDir, { recursive: true, force: true });
      this.current = null;
      const detail = stderr.trim().slice(-1500);
      throw new Error(detail ? `${error.message} Chromium: ${detail}` : error.message);
    }
  }

  async navigate(url) {
    if (!this.current) throw Object.assign(new Error('No browser session is active.'), { statusCode: 409 });
    const safeUrl = validateNavigationUrl(url);
    const loadEvent = this.current.cdp.waitForEvent('Page.loadEventFired', 10000);
    const result = await this.current.cdp.send('Page.navigate', { url: safeUrl }, 10000);
    if (result.errorText) throw new Error(`Chromium navigation failed: ${result.errorText}`);
    await loadEvent;

    const evaluation = await this.current.cdp.send('Runtime.evaluate', {
      expression: '({title: document.title, url: location.href, readyState: document.readyState})',
      returnByValue: true,
    });
    const value = evaluation.result?.value || {};
    this.current.url = String(value.url || safeUrl);
    this.current.title = String(value.title || '');

    return {
      active: true,
      phase: 2,
      sessionId: this.current.sessionId,
      pid: this.current.process.pid,
      url: this.current.url,
      title: this.current.title,
      readyState: String(value.readyState || ''),
      control: 'cdp',
    };
  }

  async stop() {
    if (!this.current) {
      return {
        active: false,
        phase: 2,
        cleanup: { rootExited: true, orphanPids: [], zombiePids: [] },
      };
    }

    const session = this.current;
    this.current = null;
    const rootPid = session.process.pid;
    const trackedPids = collectProcessTree(rootPid);

    session.cdp.close();
    try { session.process.kill('SIGTERM'); } catch {}
    let rootExited = await waitForExit(session.process, 5000);
    if (!rootExited) {
      try { session.process.kill('SIGKILL'); } catch {}
      rootExited = await waitForExit(session.process, 2000);
    }

    await sleep(250);
    let orphanPids = trackedPids.filter((pid) => existsSync(`/proc/${pid}`));
    for (const pid of orphanPids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    if (orphanPids.length) await sleep(250);

    orphanPids = trackedPids.filter((pid) => existsSync(`/proc/${pid}`));
    const zombiePids = orphanPids.filter((pid) => readProcessState(pid) === 'Z');
    rmSync(session.userDataDir, { recursive: true, force: true });

    return {
      active: false,
      phase: 2,
      sessionId: session.sessionId,
      pid: rootPid,
      cleanup: { rootExited, orphanPids, zombiePids },
    };
  }
}
