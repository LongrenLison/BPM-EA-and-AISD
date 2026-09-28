import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const apiBase = (process.env.CAMUNDA_API_URL ?? 'http://localhost:8080/v2').replace(/\/$/, '');
const resources = [
  join(root, '02-treatment-booking-and-funding-payment-investigation-follow-up.bpmn'),
  ...[
    'hospital-task-update.form',
    'treatment-appointment-confirmation.form',
    'treatment-authorisation.form',
    'treatment-funding-decision.form',
    'treatment-payment-investigation.form',
    'treatment-payment-issue-notification.form',
    'treatment-urgent-override.form'
  ].map((name) => join(root, 'forms', name))
];

const body = new FormData();
for (const path of resources) {
  const content = await readFile(path);
  const contentType = path.endsWith('.bpmn') ? 'application/xml' : 'application/json';
  body.append('resources', new Blob([content], { type: contentType }), basename(path));
}

const response = await fetch(`${apiBase}/deployments`, { method: 'POST', body });
const payload = await response.json().catch(() => undefined);
if (!response.ok) {
  throw new Error(`Deployment failed (${response.status}): ${JSON.stringify(payload)}`);
}

const deployed = payload.deployments ?? [];
const processDefinition = deployed.find((entry) => entry.processDefinition)?.processDefinition;
const forms = deployed.filter((entry) => entry.form).map((entry) => entry.form.formId);
if (!processDefinition) throw new Error('Deployment response did not include a process definition.');
console.log(JSON.stringify({
  processDefinition: processDefinition.processDefinitionId,
  version: processDefinition.processDefinitionVersion,
  forms
}, null, 2));
