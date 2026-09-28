#!/usr/bin/env node
/** Exercises only newly created synthetic instances of the standalone process. */
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { publishEnquiry } from './workers/external-enquiry-message-worker.mjs';

const base = (process.env.CAMUNDA_REST_URL ?? 'http://localhost:8080/v2').replace(/\/$/, '');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(method, endpoint, body) {
  const response = await fetch(base + endpoint, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`${method} ${endpoint}: HTTP ${response.status} ${raw}`);
  return raw ? JSON.parse(raw) : null;
}
async function search(endpoint, filter) {
  return (await request('POST', endpoint, { filter, page: { from: 0, limit: 100 } })).items;
}
async function stateOf(key) {
  return (await search('/process-instances/search', { processInstanceKey: key }))[0];
}
async function waitFor(key, elementId) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const instance = await stateOf(key);
    if (instance?.hasIncident) throw new Error(`Incident in instance ${key}`);
    const tasks = await search('/user-tasks/search', { processInstanceKey: key, state: 'CREATED' });
    const task = tasks.find(item => item.elementId === elementId);
    if (task) return task;
    await pause(400);
  }
  throw new Error(`Timed out waiting for ${elementId} in instance ${key}`);
}
async function finishTask(key, elementId, formId, variables) {
  const task = await waitFor(key, elementId);
  const bound = await request('GET', `/user-tasks/${task.userTaskKey}/form`);
  const form = typeof bound.schema === 'string' ? JSON.parse(bound.schema) : bound.schema;
  if (form?.id !== formId) throw new Error(`${elementId} has wrong deployed form: ${form?.id}`);
  if (!task.assignee) {
    await request('POST', `/user-tasks/${task.userTaskKey}/assignment`, {
      assignee: 'demo', allowOverride: false
    });
  }
  await request('POST', `/user-tasks/${task.userTaskKey}/completion`, { variables });
  return { elementId, formId, userTaskKey: task.userTaskKey };
}
async function start(label) {
  const token = randomUUID().slice(0, 8);
  const result = await request('POST', '/process-instances', {
    processDefinitionId: 'Hospital_Enquiry_Standalone',
    variables: { patientId: `SYNTHETIC-${label}-${token}`, journeyId: `ENQUIRY-${token}`, demoMode: true }
  });
  if (!result.processInstanceKey) throw new Error('No process instance key returned');
  return String(result.processInstanceKey);
}
async function waitComplete(key) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const instance = await stateOf(key);
    if (instance?.hasIncident) throw new Error(`Incident in instance ${key}`);
    if (instance?.state === 'COMPLETED') return;
    await pause(400);
  }
  throw new Error(`Timed out waiting for completion of ${key}`);
}

const report = { checkedAt: new Date().toISOString(), processId: 'Hospital_Enquiry_Standalone', scenarios: [] };
const intake = (type, priority = 'routine') => ({
  patientId: `SYNTHETIC-${type}`, enquiryType: type, enquiryPriority: priority,
  enquirySummary: 'Synthetic enquiry for local integration verification', enquiryHandlerId: 'demo-handler'
});
const response = resolved => ({
  enquiryResponse: 'Synthetic response recorded for local integration verification',
  responseStaffId: 'demo-responder', enquiryResolved: resolved
});

const adminKey = await start('admin');
const adminTasks = [];
adminTasks.push(await finishTask(adminKey, 'Q_Record', 'h-enquiry-intake', intake('administrative')));
adminTasks.push(await finishTask(adminKey, 'Q_Admin', 'h-enquiry-response', response(true)));
await waitComplete(adminKey);
report.scenarios.push({ name: 'administrative-complete', processInstanceKey: adminKey, state: 'COMPLETED', tasks: adminTasks });

const clinicalKey = await start('clinical');
const clinicalTasks = [];
clinicalTasks.push(await finishTask(clinicalKey, 'Q_Record', 'h-enquiry-intake', intake('clinical', 'urgent')));
clinicalTasks.push(await finishTask(clinicalKey, 'Q_Triage', 'h-enquiry-triage', {
  clinicalUrgency: 'urgent', triageNotes: 'Synthetic urgent triage', triageClinicianId: 'demo-clinician'
}));
clinicalTasks.push(await finishTask(clinicalKey, 'Q_UrgentResponse', 'h-enquiry-response', response(false)));
clinicalTasks.push(await finishTask(clinicalKey, 'Q_Record', 'h-enquiry-intake', intake('administrative')));
clinicalTasks.push(await finishTask(clinicalKey, 'Q_Admin', 'h-enquiry-response', response(true)));
await waitComplete(clinicalKey);
report.scenarios.push({ name: 'clinical-urgent-reassign-complete', processInstanceKey: clinicalKey, state: 'COMPLETED', tasks: clinicalTasks });

const published = await publishEnquiry({
  patientId: `SYNTHETIC-MESSAGE-${randomUUID().slice(0, 8)}`,
  demoMode: true
}, base);
const messageKey = published.processInstanceKey;
const messageTasks = [];
messageTasks.push(await finishTask(messageKey, 'Q_Record', 'h-enquiry-intake', intake('appointment')));
messageTasks.push(await finishTask(messageKey, 'Q_Appointment', 'h-enquiry-response', response(true)));
await waitComplete(messageKey);
report.scenarios.push({ name: 'external-message-appointment-complete', processInstanceKey: messageKey,
  correlationKey: published.correlationKey, messageName: published.messageName, state: 'COMPLETED', tasks: messageTasks });

if (process.argv.includes('--leave-open')) {
  const openKey = await start('tasklist');
  const openTask = await waitFor(openKey, 'Q_Record');
  report.scenarios.push({ name: 'tasklist-open', processInstanceKey: openKey, state: 'ACTIVE',
    task: { elementId: openTask.elementId, userTaskKey: openTask.userTaskKey } });
}
await writeFile(new URL('./verification-last.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
