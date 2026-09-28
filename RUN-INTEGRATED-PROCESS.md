# Integrated hospital process runbook

## Deploy and run

1. In Camunda Modeler, deploy `models/00-integrated-hospital-patient-administration.bpmn` and all files in `forms/` to the local C8Run connection.
2. With Node.js 18 or later installed, start the external worker:

   ```powershell
   node .\workers\referral-service-worker.mjs
   ```
3. Publish the `Referral received` message with a unique correlation key and at least `patientId`. The Message Start Event creates the process instance.
4. Complete the User Tasks in Tasklist using the linked forms. The happy-path values are shown below.

```powershell
$body = @{ name = 'Referral received'; correlationKey = "hospital-$([guid]::NewGuid())"; variables = @{ patientId = 'demo-patient-001' } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/v2/messages/correlation' -ContentType 'application/json' -Body $body
```

## Happy-path User Task variables

| Task | Required value |
|---|---|
| Check supporting information | `documentsComplete = "complete"` |
| Review referral clinically | `referralDecision = "accept"` |
| Record consent and authorise request | `treatmentRequestAuthorised = "authorised"` |
| Record funding approval or limitation | `advancePaymentRequired = false` |
| Record, classify and assign priority | `enquiryType = "administrative"` |

All other User Tasks must be completed with the form's required fields. The
Node.js worker returns the remaining gateway variables.

The worker records two executable patient notifications: the appointment letter
and the enquiry-resolution notification. Its console output includes the
notification content, recipient, channel and result.

## Alternative-path environment variables

| Variable | Values | Affected gateway |
|---|---|---|
| `DEMO_SLOT_FOUND` | `true` / `false` | Slot within timeframe |
| `DEMO_WITHIN_TWO_WEEKS` | `true` / `false` | Within two weeks |
| `DEMO_ADVANCE_PAYMENT_REQUIRED` | `true` / `false` | Advance payment required |
| `DEMO_PAYMENT_STATUS` | `completed`, `investigate`, `declined`, `cancelled`, `urgent` | Payment outcome |

Gateway defaults provide safe handling when a variable is absent: request missing information, reject a referral, escalate an unavailable slot, stop an unauthorised treatment request, request payment, investigate an unconfirmed payment, route enquiry to clinical triage, and telephone the patient.

## Manual resolution of alternative routes

- When no appointment is available, complete **Review pathway capacity** with
  one of: search again, confirm a manually arranged appointment, or close the
  referral after notifying the patient. Only the first option re-runs the
  scheduling service.
- After a payment status of `investigate`, `declined`, or `cancelled`, complete
  the payment-resolution form. Its required resolution (`completed`, `retry`,
  `urgent`, or `close`) controls the next gateway directly, so a manual decision
  is not overwritten by the worker.
