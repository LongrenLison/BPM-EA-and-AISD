# Integrated hospital process runbook

## Deploy and run

1. In Camunda Modeler, deploy `models/00-integrated-hospital-patient-administration.bpmn` and all files in `forms/` to the local C8Run connection.
2. In the Java worker directory, run `mvn spring-boot:run`.
3. Publish the `Referral received` message with a unique correlation key and at least `patientId`.
4. Complete the User Tasks in Tasklist using the linked forms. The happy-path values are shown below.

```powershell
$body = @{ name = 'Referral received'; correlationKey = "hospital-$([guid]::NewGuid())"; variables = @{ patientId = 'demo-patient-001' } } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri 'http://localhost:8080/v2/messages/correlation' -ContentType 'application/json' -Body $body
```

## Happy-path User Task variables

| Task | Required value |
|---|---|
| Check supporting information | `documentsComplete = true` |
| Review referral clinically | `referralDecision = "accept"` |
| Record consent and authorise request | `treatmentRequestAuthorised = true` |
| Record funding approval or limitation | `advancePaymentRequired = false` |
| Record, classify and assign priority | `enquiryType = "administrative"` |

All other User Tasks must be completed with the form's required fields. The Java workers return the remaining gateway variables.

## Alternative-path environment variables

| Variable | Values | Affected gateway |
|---|---|---|
| `DEMO_SLOT_FOUND` | `true` / `false` | Slot within timeframe |
| `DEMO_WITHIN_TWO_WEEKS` | `true` / `false` | Within two weeks |
| `DEMO_ADVANCE_PAYMENT_REQUIRED` | `true` / `false` | Advance payment required |
| `DEMO_PAYMENT_STATUS` | `completed`, `investigate`, `declined`, `cancelled`, `urgent` | Payment outcome |

Gateway defaults provide safe handling when a variable is absent: request missing information, reject a referral, escalate an unavailable slot, stop an unauthorised treatment request, request payment, investigate an unconfirmed payment, route enquiry to clinical triage, and telephone the patient.
