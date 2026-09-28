/*
 * Local demonstration Worker for the integrated hospital administration process.
 * Human-facing work stays in Camunda User Tasks and Tasklist.
 * Replace the deterministic demo handlers with real service adapters before production use.
 */

const apiBase = (process.env.CAMUNDA_API_URL ?? 'http://localhost:8080/v2').replace(/\/$/, '');
const worker = process.env.WORKER_ID ?? 'referral-service-worker';
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 1_000);

class BpmnJobError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BpmnJobError';
    this.code = code;
  }
}

const handlers = {
  'scheduling.search': async () => ({
    slotFound: process.env.DEMO_SLOT_FOUND !== 'false'
  }),
  'correspondence.dispatch': async () => ({
    appointmentWithinTwoWeeks: process.env.DEMO_WITHIN_TWO_WEEKS === 'true'
  }),
  'referral.request-information': async () => ({
    informationRequestRecorded: true
  }),
  'treatment.capacity-check': async () => {
    if (process.env.DEMO_EXTERNAL_UNAVAILABLE === 'true') {
      throw new BpmnJobError('EXTERNAL_UNAVAILABLE', 'Treatment capacity service is unavailable');
    }
    return { treatmentCapacityAvailable: process.env.DEMO_CAPACITY_AVAILABLE !== 'false' };
  },
  'funding.assess': async () => ({
    advancePaymentRequired: process.env.DEMO_ADVANCE_PAYMENT_REQUIRED === 'true'
  }),
  'payment.request': async (job) => {
    // Stable across retries of this same job. A real PSP adapter must send this
    // value as its idempotency key so a retry cannot create a second charge.
    const paymentIdempotencyKey = `treatment-payment-${job.processInstanceKey}-${job.jobKey}`;
    console.log(`[${new Date().toISOString()}] payment demo request; idempotencyKey=${paymentIdempotencyKey}`);
    return {
      providerPaymentStatus: process.env.DEMO_PAYMENT_STATUS ?? 'completed',
      paymentIdempotencyKey
    };
  },
  'payment.status.request': async (job) => {
    const correlationKey = String(job.processInstanceKey);
    const providerPaymentStatus = process.env.DEMO_PROVIDER_STATUS ?? 'completed';

    // This demo publishes the PSP callback before completing the worker job.
    // The short TTL buffers it until the process opens the message subscription.
    await request('/messages/publication', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Payment status and transaction reference',
        correlationKey,
        messageId: `payment-status-${job.jobKey}`,
        timeToLive: 60_000,
        variables: {
          providerPaymentStatus,
          transactionReference: `demo-transaction-${job.processInstanceKey}`
        }
      })
    });
    return { paymentCorrelationKey: correlationKey };
  },
  'payment.status.receive': async () => ({
    paymentStatus: process.env.DEMO_PAYMENT_STATUS ?? 'completed'
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
      worker,
      timeout: 30_000,
      maxJobsToActivate: 1,
      requestTimeout: -1
    })
  });

  const job = activation.jobs[0];
  if (!job) return;

  try {
    const variables = await handler(job);
    await request(`/jobs/${job.jobKey}/completion`, {
      method: 'POST',
      body: JSON.stringify({ variables })
    });
    console.log(`[${new Date().toISOString()}] completed ${job.elementId} (${jobType}), job=${job.jobKey}`);
  } catch (error) {
    if (!(error instanceof BpmnJobError)) throw error;

    await request(`/jobs/${job.jobKey}/error`, {
      method: 'POST',
      body: JSON.stringify({
        errorCode: error.code,
        errorMessage: error.message
      })
    });
    console.log(`[${new Date().toISOString()}] threw BPMN error ${error.code} from ${job.elementId}`);
  }
}

async function poll() {
  for (const [jobType, handler] of Object.entries(handlers)) {
    await handleOne(jobType, handler);
  }
}

console.log(`Worker ${worker} is listening at ${apiBase} for: ${Object.keys(handlers).join(', ')}`);
setInterval(() => {
  poll().catch((error) => console.error(`[${new Date().toISOString()}] ${error.message}`));
}, pollIntervalMs);
void poll();
