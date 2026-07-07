import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const VALID_AXES = new Set(['X', 'Y', 'Z']);

export const POST: RequestHandler = async ({ request, fetch }) => {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const axisValue = body.axis;
  const amountValue = body.amount;
  const feedValue = body.feed_mm_s;

  const axis = typeof axisValue === 'string' ? axisValue.trim().toUpperCase() : null;
  if (!axis || !VALID_AXES.has(axis)) {
    return json({ ok: false, error: 'Invalid axis. Expected X, Y or Z.' }, { status: 400 });
  }

  const amount =
    typeof amountValue === 'number' && Number.isFinite(amountValue) ? amountValue : NaN;
  if (!Number.isFinite(amount)) {
    return json({ ok: false, error: 'Invalid amount. Must be a finite number.' }, { status: 400 });
  }

  const feedMmS =
    typeof feedValue === 'number' && Number.isFinite(feedValue) ? feedValue : NaN;
  if (!Number.isFinite(feedMmS) || feedMmS <= 0) {
    return json(
      { ok: false, error: 'Invalid feed_mm_s. Must be a positive number.' },
      { status: 400 }
    );
  }

  const feedMmMin = Math.max(1, Math.round(feedMmS * 60));
  const gcode = ['G91', `G1 ${axis}${amount} F${feedMmMin}`, 'G90'].join('\n');

  let resp: Response;
  try {
    resp = await fetch('/moonraker/printer/gcode/script', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: gcode })
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json(
      { ok: false, error: 'Failed to contact Moonraker', detail: message },
      { status: 502 }
    );
  }

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    return json({ ok: false, status: resp.status, data }, { status: resp.status });
  }

  return json({ ok: true, data });
};
