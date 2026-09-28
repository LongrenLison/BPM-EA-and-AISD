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
adds editable normal-time and accelerated BPMN models, four bound forms,
simulated workers, readable PNG/SVG/PDF diagrams, a local runner, test plans,
test evidence and a short bilingual briefing. It has **not** been connected to
the integrated model above; the existing group models, forms and workers are
unchanged by this addition.

- [Personal status](tools/clinic-letter-sprint02/PERSONAL_STATUS.md)
- [Editable BPMN](tools/clinic-letter-sprint02/clinic-letter-sprint02.bpmn)
- [Diagram](tools/clinic-letter-sprint02/clinic-letter-preview.png)
- [Test results](tools/clinic-letter-sprint02/TEST_RESULTS.md)
- [Local demo instructions](tools/clinic-letter-sprint02/DEMO_RUN_GUIDE.md)

Verification: 55 offline checks and eight local Camunda 8.9.21 API scenarios
passed. Dispatch and notifications remain simulated; real email, role
permissions and formal long-duration timers are not verified. The case's
approximately two-week receipt target is not represented as a separate
delivery-confirmation workflow; the seven-day dispatch and delay-monitoring
model is preserved. Uploading this module is not an assessment submission.
