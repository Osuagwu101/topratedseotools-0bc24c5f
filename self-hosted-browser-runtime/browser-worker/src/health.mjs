import { existsSync } from 'node:fs';

export function buildHealthPayload(env = process.env) {
  const browserExecutable = env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  return {
    status: 'ok',
    service: 'browser-worker',
    phase: 2,
    browserCore: 'generic',
    control: 'cdp',
    chromium: {
      executable: browserExecutable,
      installed: existsSync(browserExecutable),
    },
  };
}
