// ---------------------------------------------------------------------------
// Optional room persistence via Upstash Redis (REST API). Activates only
// when both UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN env vars
// are set; otherwise the server runs in-memory only and rooms vanish on
// restart (current behaviour).
//
// Why Upstash: free tier (10K cmds/day), HTTP-based so no extra Redis
// client dep, works on any PaaS (Render free, Fly free).
// Why persistence: Render free instances restart on every deploy and
// occasionally for maintenance, taking every active room with them.
// Persisting lets clients auto-rejoin into the same game on the other side.
//
// Storage layout:
//   ludo:room:CODE -> JSON snapshot of the Room (seats, game, phase, ...)
//   24h TTL on every write so abandoned rooms eventually self-clean.
// ---------------------------------------------------------------------------

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const ENABLED = !!(URL_BASE && TOKEN);
const KEY_PREFIX = 'ludo:room:';
const TTL_SECONDS = 24 * 60 * 60;

export const persistenceEnabled = ENABLED;

async function execute(commandArr) {
  if (!ENABLED) return null;
  try {
    const res = await fetch(URL_BASE, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(commandArr),
    });
    if (!res.ok) {
      console.warn('[persistence]', res.status, await res.text().catch(() => ''));
      return null;
    }
    return res.json();
  } catch (err) {
    console.warn('[persistence] error:', err.message);
    return null;
  }
}

export async function saveRoomBlob(code, jsonString) {
  return execute(['SET', `${KEY_PREFIX}${code}`, jsonString, 'EX', TTL_SECONDS]);
}

export async function deleteRoomBlob(code) {
  return execute(['DEL', `${KEY_PREFIX}${code}`]);
}

/** Returns array of {code, blob} where blob is the JSON string. */
export async function loadAllRoomBlobs() {
  if (!ENABLED) return [];
  // SCAN for all matching keys.
  const keys = [];
  let cursor = '0';
  do {
    const r = await execute(['SCAN', cursor, 'MATCH', `${KEY_PREFIX}*`, 'COUNT', '500']);
    if (!r?.result) break;
    cursor = r.result[0];
    keys.push(...r.result[1]);
  } while (cursor !== '0');

  if (keys.length === 0) return [];
  // Pipeline MGET via a multi-command request.
  const r = await execute(['MGET', ...keys]);
  if (!r?.result) return [];
  return keys.map((k, i) => ({
    code: k.slice(KEY_PREFIX.length),
    blob: r.result[i],
  })).filter((x) => !!x.blob);
}
