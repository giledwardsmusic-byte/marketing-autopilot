const DEFAULT_GRAPH_HOST = 'https://graph.facebook.com';

function graphUrl(host, version, path) {
  return `${String(host || DEFAULT_GRAPH_HOST).replace(/\/$/, '')}/${version}/${path}`;
}

async function readJson(response, label) {
  let data = null;
  try { data = await response.json(); }
  catch { throw new Error(`${label} returned non-JSON response (${response.status})`); }
  if (!response.ok || data?.error) {
    const message = data?.error?.message || data?.message || JSON.stringify(data);
    throw new Error(`${label} ${response.status}: ${message}`);
  }
  return data;
}

export async function waitForInstagramContainer({
  creationId,
  token,
  apiVersion = 'v25.0',
  host = DEFAULT_GRAPH_HOST,
  fetchFn = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxAttempts = 10,
  pollIntervalMs = 1500
}) {
  if (!creationId) throw new Error('Instagram creation_id is required');
  if (!token) throw new Error('Instagram access token is required');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const params = new URLSearchParams({ fields: 'status_code,status', access_token: token });
    const r = await fetchFn(`${graphUrl(host, apiVersion, creationId)}?${params.toString()}`);
    const data = await readJson(r, 'Instagram container status');
    const status = String(data.status_code || '').toUpperCase();

    if (status === 'FINISHED' || status === 'PUBLISHED') return data;
    if (['ERROR', 'EXPIRED'].includes(status)) {
      throw new Error(`Instagram media container ${status.toLowerCase()}: ${data.status || 'unknown platform error'}`);
    }
    if (attempt < maxAttempts) await sleep(pollIntervalMs);
  }

  throw new Error(`Instagram media container was not ready after ${maxAttempts} checks`);
}

export async function publishInstagramImage({
  igUserId,
  token,
  imageUrl,
  caption = '',
  apiVersion = 'v25.0',
  host = DEFAULT_GRAPH_HOST,
  fetchFn = fetch,
  sleep,
  maxAttempts,
  pollIntervalMs
}) {
  if (!igUserId) throw new Error('Instagram ig_user_id is required');
  if (!token) throw new Error('Instagram access token is required');
  if (!imageUrl) throw new Error('Instagram image_url is required');

  const createForm = new URLSearchParams({
    image_url: imageUrl,
    caption: String(caption || ''),
    access_token: token
  });
  const createResponse = await fetchFn(graphUrl(host, apiVersion, `${igUserId}/media`), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: createForm
  });
  const created = await readJson(createResponse, 'Instagram create');
  if (!created.id) throw new Error('Instagram returned no media container id');

  await waitForInstagramContainer({
    creationId: created.id,
    token,
    apiVersion,
    host,
    fetchFn,
    sleep,
    maxAttempts,
    pollIntervalMs
  });

  const publishForm = new URLSearchParams({ creation_id: created.id, access_token: token });
  const publishResponse = await fetchFn(graphUrl(host, apiVersion, `${igUserId}/media_publish`), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: publishForm
  });
  const published = await readJson(publishResponse, 'Instagram publish');
  if (!published.id) throw new Error('Instagram returned no published media id');

  return { externalId: published.id, creationId: created.id, state: 'published' };
}
