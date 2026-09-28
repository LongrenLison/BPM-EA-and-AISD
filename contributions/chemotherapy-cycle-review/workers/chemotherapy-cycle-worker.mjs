/*
 * Local demonstration Worker for chemotherapy-cycle service tasks.
 * Human-facing clinical, booking, and Finance steps stay in BPMN user tasks
 * and are completed in Tasklist; this worker only mocks external services.
 */

const apiBase = (process.env.CAMUNDA_API_URL ?? 'http://localhost:8080/v2').replace(/\/$/, '');
const workerName = process.env.WORKER_ID ?? 'chemotherapy-cycle-worker';
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 1_000);

function envBoolean(name, defaultValue) {
  const value = process.env[name];
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === 'true';
}

const handlers = {
  'clinical-results.request': async () => ({
    resultsAvailable: envBoolean('DEMO_RESULTS_AVAILABLE', true),
    resultReference: 'LAB-DEMO-001'
  }),
  'chemotherapy.schedule-update': async () => ({
    scheduleUpdated: envBoolean('DEMO_SCHEDULE_UPDATED', true),
    scheduleReference: 'CYCLE-DEMO-001'
  }),
  'correspondence.notify-cycle-plan': async () => ({
    notificationSent: envBoolean('DEMO_NOTIFICATION_SENT', true),
    notificationReference: 'NOTICE-DEMO-001'
  })
};

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
  });
  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${await response.text()}`);
  }
  return response.status === 204 ? undefined : response.json();
}

async function handleOne(jobType, handler) {
  const activation = await request('/jobs/activation', {
    method: 'POST',
    body: JSON.stringify({
      type: jobType,
      worker: workerName,
      timeout: 30_000,
      maxJobsToActivate: 1,
      requestTimeout: -1
    })
  });

  const job = activation.jobs?.[0];
  if (!job) return;
  const variables = await handler(job);
  await request(`/jobs/${job.jobKey}/completion`, {
    method: 'POST',
    body: JSON.stringify({ variables })
  });
  console.log(`[${new Date().toISOString()}] completed ${job.elementId} (${jobType}), job=${job.jobKey}`, variables);
}

async function poll() {
  for (const [jobType, handler] of Object.entries(handlers)) {
    await handleOne(jobType, handler);
  }
}

console.log(`Worker ${workerName} is listening at ${apiBase} for: ${Object.keys(handlers).join(', ')}`);
setInterval(() => {
  poll().catch((error) => console.error(`[${new Date().toISOString()}] ${error.message}`));
}, pollIntervalMs);
void poll();
