# Hospital Patient Administration System

This repository contains the integrated, executable Camunda 8 initial release
for the hospital patient administration case study.

## Submitted implementation artefacts

- `models/00-integrated-hospital-patient-administration.bpmn` — the sole
  editable BPMN model.  It contains the referral, treatment and patient-enquiry
  routes, User Tasks, Service Tasks, gateways, events, participant interaction
  and task-to-form bindings.
- `forms/` — editable Camunda Forms referenced by the User Tasks in the model.
- `workers/referral-service-worker.mjs` — Node.js 18+ external worker for the
  Service Task job types.
- `workers/README.md` and `RUN-INTEGRATED-PROCESS.md` — dependency,
  configuration, deployment and demonstration instructions.

## Quick start

1. Deploy the BPMN file and every form in `forms/` to the Camunda 8 local
   connection.
2. Run `node .\\workers\\referral-service-worker.mjs`.
3. Follow `RUN-INTEGRATED-PROCESS.md` to create an instance and complete its
   user tasks in Tasklist.

The worker deliberately simulates external scheduling, funding, payment and
correspondence services. Its configuration variables and demonstration limits
are documented in `workers/README.md`.
