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

## Standalone Clinic Letter personal module

The independent [Clinic Letter module](tools/clinic-letter-sprint02/README.md)
contains the current accelerated BPMN, four forms and a Java demo worker for
Camunda 8.10.0-alpha5. It is not connected to the integrated group process.

- [Current editable BPMN](tools/clinic-letter-sprint02/clinic-letter-sprint02-demo.bpmn)
- [Deployment and Tasklist walkthrough](tools/clinic-letter-sprint02/README.md)
- [Java source and run instructions](tools/clinic-letter-sprint02/java/README.md)
- [Recorded engine verification](tools/clinic-letter-sprint02/java/evidence/java-engine-verification.json)

The former personal BPMN files have been removed from this branch; their
versions remain in Git history. Six Java test groups passed, eight isolated
local engine scenarios are recorded, and the manual DEMO-CL-002 walkthrough
completed. Sending and notifications are simulated. Real hospital integration,
role permissions and production delivery are not validated. This personal
module upload is not an assessment submission.
