export type MachineStatusResult = {
  status?: Record<string, any>;
};

export type ProcStatsResult = {
  moonraker_stats?: Array<{ time?: number; cpu_usage?: number; memory?: number; mem_units?: string }>;
  cpu_temp?: number | null;
  system_cpu_usage?: Record<string, number>;
  system_memory?: { total?: number; used?: number; available?: number };
  system_uptime?: number;
  network?: Record<string, { bandwidth?: number; rx_drop?: number; tx_drop?: number }>;
  websocket_connections?: number;
};

const MOONRAKER_PROXY_BASE = '/moonraker';
const getInFlight = new Map<string, Promise<unknown>>();

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok || data?.error) {
    throw new Error(data?.error ?? data?.message ?? text ?? `Request failed (${response.status})`);
  }

  return data as T;
}

async function apiGet<T>(path: string) {
  const existing = getInFlight.get(path);
  if (existing) return existing as Promise<T>;

  const request = fetch(path, { cache: 'no-store' })
    .then((response) => parseResponse<T>(response))
    .finally(() => {
      getInFlight.delete(path);
    });

  getInFlight.set(path, request);
  return request;
}

async function apiPost<T>(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: body instanceof FormData || !body ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
  });
  return parseResponse<T>(response);
}

function moonrakerGet<T>(path: string) {
  return apiGet<T>(`${MOONRAKER_PROXY_BASE}${path}`);
}

function moonrakerPost<T>(path: string, body?: unknown) {
  return apiPost<T>(`${MOONRAKER_PROXY_BASE}${path}`, body);
}

function toGcodeCommand(script: string) {
  return moonrakerPost<{ result?: unknown }>('/printer/gcode/script', { script });
}

export const machineApi = {
  getStatus(includeConfig = false) {
    const query = [
      'toolhead=position,homed_axes',
      'gcode_move=gcode_position,absolute_coordinates',
      'print_stats=state,message',
      'webhooks=state,state_message',
      'display_status=message'
    ];

    if (includeConfig) query.push('configfile=settings');

    return moonrakerGet<{ result: MachineStatusResult }>(`/printer/objects/query?${query.join('&')}`);
  },
  sendGcode(script: string) {
    return toGcodeCommand(script);
  },
  home(axis: 'X' | 'Y' | 'Z') {
    return toGcodeCommand(`G28 ${axis}`);
  },
  jog(axis: 'X' | 'Y' | 'Z', distance: number, speedMmPerSec: number) {
    const feedrate = Math.round(Math.max(1, speedMmPerSec) * 60);
    return toGcodeCommand(`G91\nG0 ${axis.toUpperCase()}${distance.toFixed(3)} F${feedrate}\nG90`);
  },
  moveAbsolute(axis: 'X' | 'Y' | 'Z', value: number, speedMmPerSec: number) {
    const feedrate = Math.round(Math.max(1, speedMmPerSec) * 60);
    return toGcodeCommand(`G90\nG0 ${axis.toUpperCase()}${value.toFixed(3)} F${feedrate}`);
  },
  setKinematicPosition(values: Partial<Record<'X' | 'Y' | 'Z', number>>) {
    const parts = Object.entries(values)
      .filter((entry): entry is ['X' | 'Y' | 'Z', number] => typeof entry[1] === 'number')
      .map(([axis, value]) => `${axis}=${value.toFixed(3)}`);

    if (!parts.length) throw new Error('No kinematic coordinates provided');
    return toGcodeCommand(`SET_KINEMATIC_POSITION ${parts.join(' ')}`);
  },
  async restart() {
    try {
      return await moonrakerPost<{ result?: unknown }>('/printer/restart');
    } catch {
      return toGcodeCommand('RESTART');
    }
  },
  emergencyStop() {
    return moonrakerPost<{ result?: unknown }>('/printer/emergency_stop');
  },
  async firmwareRestart() {
    try {
      return await moonrakerPost<{ result?: unknown }>('/printer/firmware_restart');
    } catch {
      return toGcodeCommand('FIRMWARE_RESTART');
    }
  },
  upload(formData: FormData) {
    return moonrakerPost<{ result?: { item?: { path?: string } }; item?: { path?: string } }>('/server/files/upload', formData)
      .then((payload) => ({
        ...payload,
        path:
          payload?.result?.item?.path ??
          payload?.item?.path ??
          String(formData.get('path') ?? '')
      }));
  },
  torchOn() {
    return toGcodeCommand('TORCH_ON');
  },
  torchOff() {
    return toGcodeCommand('TORCH_OFF');
  },
  queryEndstops() {
    return moonrakerGet<{ result?: Record<string, string> }>('/printer/query_endstops/status');
  },
  getProcStats() {
    return moonrakerGet<{ result?: ProcStatsResult }>('/machine/proc_stats');
  }
};
