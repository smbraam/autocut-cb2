import { json } from '@sveltejs/kit';

export async function POST({ request, fetch }) {
  const { axis } = await request.json();

  // Home 1 as
  const gcode = `G28 ${axis.toUpperCase()}`;

  const resp = await fetch('/moonraker/printer/gcode/script', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script: gcode })
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    return json({ ok: false, status: resp.status, data }, { status: 500 });
  }

  return json({ ok: true, data });
}
