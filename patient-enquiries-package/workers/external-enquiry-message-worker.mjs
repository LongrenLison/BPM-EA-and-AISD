#!/usr/bin/env node
/** External-participant adapter: publishes one patient enquiry message on demand. */
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const messageName = 'Patient enquiry received (standalone)';

export async function publishEnquiry(input, baseUrl = process.env.CAMUNDA_REST_URL ?? 'http://localhost:8080/v2') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Enquiry input must be a JSON object.');
  }
  if (typeof input.patientId !== 'string' || !input.patientId.trim()) {
    throw new Error('patientId must be a non-empty string.');
  }
  const journeyId = input.journeyId ?? `ENQUIRY-${randomUUID()}`;
  if (typeof journeyId !== 'string' || !journeyId.trim()) {
    throw new Error('journeyId must be a non-empty string.');
  }
  const variables = { ...input, patientId: input.patientId.trim(), journeyId, demoMode: input.demoMode ?? true };
  if (typeof variables.demoMode !== 'boolean') {
    throw new Error('demoMode must be a JSON boolean.');
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/messages/correlation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: messageName, correlationKey: journeyId, variables }),
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Message correlation failed (HTTP ${response.status}): ${raw}`);
  const result = raw ? JSON.parse(raw) : null;
  if (!result?.processInstanceKey) throw new Error(`No process instance was created: ${raw}`);
  return { processInstanceKey: String(result.processInstanceKey), correlationKey: journeyId, messageName };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fileIndex = process.argv.indexOf('--file');
  if (fileIndex >= 0 && !process.argv[fileIndex + 1]) throw new Error('--file requires a JSON path.');
  const input = fileIndex >= 0
    ? JSON.parse(await readFile(resolve(process.argv[fileIndex + 1]), 'utf8'))
    : { patientId: `SYNTHETIC-${randomUUID().slice(0, 8)}` };
  console.log(JSON.stringify(await publishEnquiry(input), null, 2));
}
