import { json } from '@sveltejs/kit';

/**
 * Relays uploaded files to Moonraker using the /moonraker proxy path.
 * Wraps the incoming File in multipart/form-data so Moonraker accepts it.
 * After updating this route, consider verifying with `npm run check`.
 */
export async function POST({ request, fetch }) {
  try {
    const data = await request.formData();
    const file = data.get('file');

    if (!(file instanceof File)) {
      return json({ error: 'No file uploaded' }, { status: 400 });
    }

    const relay = new FormData();
    relay.append('file', file, file.name);

    const response = await fetch('/moonraker/server/files/upload', {
      method: 'POST',
      body: relay
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Moonraker upload failed: ${errorText}`);
    }

    return json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, { status: 500 });
  }
}
