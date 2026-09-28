# Clinic Letter — current Java demonstration

Updated 28 September 2026. This independent personal module has not been integrated into the group's main hospital process. Correspondence and notifications are simulated.

## Current files

- `clinic-letter-sprint02-demo.bpmn`: the current executable model used in the completed manual demonstration.
- `forms/`: four deployment-bound forms for drafting, clinical approval, administrative checks and authorised dispatch retry.
- `.process-application`: deploys this BPMN and the four forms together in Camunda Modeler.
- `java/`: Java worker source, Maven dependencies, six logic test groups and recorded engine verification evidence.

The previous normal-time BPMN, original model and failed draft have been removed from this branch. Git commit history retains them. Existing Node scripts, old guides, exports and earlier evidence are historical material; use the Java instructions here for the current demonstration. Older Node tests/scripts expect the removed normal-time model and are not the current validation entry point.

## Run the current demonstration

1. Start a local Camunda 8 Run **8.10.0-alpha5** engine. The worker checks this exact engine version. REST is `http://127.0.0.1:8080`; gRPC is `http://127.0.0.1:26500`.
2. In Modeler **5.51.1**, open this process application and deploy the BPMN together with all four forms. The local connection URL is `http://localhost:8080/v2/`, with no authentication.
3. Import `java/pom.xml` into IntelliJ IDEA using JDK 21 or newer. Run `local.clinic.ClinicLetterWorker` with program arguments `--local-demo --minutes 30`. Wait for `READY`.
4. Start one process instance in Modeler using synthetic variables, for example:

```json
{
  "clinicLetterId": "DEMO-CL-003",
  "simulateDispatchError": false,
  "simulateTechnicalFailuresRemaining": 0,
  "clinicalCorrectionRequested": false,
  "delayReason": ""
}
```

5. In `http://localhost:8080/tasklist`, claim and complete the draft, approval and administrative tasks. Use synthetic text in every required field. Clinical approval, recipient checking and administrative checking must all pass before dispatch.
6. In `http://localhost:8080/operate`, verify the instance is `COMPLETED` and `dispatchStatus` is `SIMULATED_SENT`.

The worker runs for the requested duration, up to 30 minutes. It does not complete human tasks. Do not run Java and the historical Node worker for the same job types simultaneously.

## Timing and exceptions

The business milestones are seven days with weekly reminders, one calendar month and three calendar months. This uploaded demonstration uses 10-second initial/repeated reminder waits and 20/30-second management waits. These are demonstration durations, not real clinical deadlines. Camunda executes the timers.

Clinical rejection or a clinical concern returns work to the Consultant and clears previous approvals. Incomplete administration returns work to the Secretary. A business dispatch rejection enters the human resolution/retry task; technical failures use limited job retries. Successful dispatch terminates remaining monitoring in this instance, without undoing notifications already recorded.

## Verification and limits

- `java/evidence/verification-summary.json`: six Java logic test groups and eight isolated local engine scenarios passed on 28 September 2026.
- `java/evidence/java-engine-verification.json`: scenario-level recorded evidence. Those scenarios used isolated process IDs/job types and included a normal-time test fixture; they are historical test results, not a promise that the current demo alone contains both time versions.
- `java/evidence/manual-demo-completed.json`: the manual Tasklist instance `2251799813709575`, model version 3, completed at 16:01:31 Asia/Shanghai with no incident. Its state was rechecked before upload.

No real email, patient data, hospital integration or production RBAC is demonstrated. The model's candidate-group labels are not proof of role-based access enforcement. Long-period calendar boundaries and production delivery guarantees require further validation.
