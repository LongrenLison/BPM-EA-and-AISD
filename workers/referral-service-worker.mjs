/*
 * Local demonstration Worker for the integrated hospital administration process.
 *
 * It handles service-task job types only. Human-facing BPMN user tasks are
 * deliberately not subscribed here: they should be completed through Tasklist.
 *
 * Node.js 18+ is required (uses the built-in fetch API).
 */

const apiBase = (process.env.CAMUNDA_API_URL ?? 'http://localhost:8080/v2').replace(/\/$/, '');
const worker = process.env.WORKER_ID ?? 'referral-service-worker';
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 1_000);

function variablesFrom(job) {
  if (!job?.variables) return {};
  if (typeof job.variables === 'object') return job.variables;
  try {
    return JSON.parse(job.variables);
  } catch {
    return {};
  }
}

function notificationDetails(job) {
  const variables = variablesFrom(job);
  const isAppointmentNotification = job.elementId === 'R_Notify';
  return {
    recipient: variables.patientId ?? 'patient-or-authorised-representative',
    channel: variables.notificationMethod ?? (isAppointmentNotification ? 'letter' : 'email'),
    content: isAppointmentNotification
      ? (variables.appointmentDetails ?? variables.taskOutcome ?? 'Appointment confirmation')
      : (variables.resolutionSummary ?? 'Enquiry resolution'),
    notificationType: isAppointmentNotification ? 'appointment' : 'enquiry-resolution'
  };
}

// Replace these deterministic demo results with real scheduling and
// correspondence integrations before using this outside a demonstration.
const handlers = {
  'scheduling.search': async () => ({
    slotFound: process.env.DEMO_SLOT_FOUND !== 'false'
  }),
  'notifications.send': async (job) => {
    const notification = notificationDetails(job);
    console.log(`[${new Date().toISOString()}] notification recorded: ${JSON.stringify(notification)}`);
    return {
      notificationSent: true,
      notificationRecipient: notification.recipient,
      notificationChannel: notification.channel,
      notificationContent: notification.content,
      ...(notification.notificationType === 'appointment'
        ? { appointmentWithinTwoWeeks: process.env.DEMO_WITHIN_TWO_WEEKS === 'true' }
        : {})
    };
  },
  'referral.request-information': async () => ({
    informationRequestRecorded: true
  }),
  'treatment.capacity-check': async () => ({
    treatmentCapacityAvailable: true
  }),
  'funding.assess': async () => ({
    advancePaymentRequired: process.env.DEMO_ADVANCE_PAYMENT_REQUIRED === 'true'
  }),
  'payment.request': async () => ({
    paymentStatus: process.env.DEMO_PAYMENT_STATUS ?? 'completed'
  }),
  'payment.status.request': async () => ({
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

  const variables = await handler(job);
  await request(`/jobs/${job.jobKey}/completion`, {
    method: 'POST',
    body: JSON.stringify({ variables })
  });
  console.log(`[${new Date().toISOString()}] completed ${job.elementId} (${jobType}), job=${job.jobKey}`);
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
