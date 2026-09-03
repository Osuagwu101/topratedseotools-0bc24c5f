import { existsSync } from 'node:fs';

export function buildHealthPayload(env = process.env) {
  const browserExecutable = env.CHROMIUM_EXECUTABLE || '/usr/bin/chromium';
  return {
    status: 'ok',
    service: 'browser-worker',
    phase: 1,
    browserCore: 'generic',
    chromium: {
      executable: browserExecutable,
      installed: existsSync(browserExecutable),
    },
  };
}
