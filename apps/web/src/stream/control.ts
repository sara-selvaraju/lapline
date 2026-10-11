// POST /api/control. The browser never calls OpenF1 itself.

import type { ControlRequest } from '@lapline/shared';

export async function post(body: ControlRequest): Promise<void> {
  try {
    await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(e);
  }
}
