import { existsSync } from 'node:fs';

export function buildHealthPayload(env = process.env) {
  const browserExecutable = env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  return {
    status: 'ok',
    service: 'browser-worker',
    phase: 3,
    browserCore: 'generic',
    control: 'cdp',
    viewer: {
      mode: 'restricted-frame-input',
      auth: 'signed-bearer',
      rawCdpExposed: false,
    },
    chromium: {
      executable: browserExecutable,
      installed: existsSync(browserExecutable),
    },
  };
}
