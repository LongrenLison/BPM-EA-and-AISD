# Integrated hospital administration Worker

This local Node.js Worker handles the service tasks in
`models/00-integrated-hospital-patient-administration.bpmn`.

```powershell
node .\workers\referral-service-worker.mjs
```

It connects to `http://localhost:8080/v2` by default and subscribes to:

- `scheduling.search` — returns `slotFound=true` by default.
- `notifications.send` — records appointment and enquiry-resolution notifications,
  including their content, recipient and channel. Appointment notifications also
  return `appointmentWithinTwoWeeks` for the telephone-contact gateway.
- `referral.request-information` — records that an information request was sent.
- `treatment.capacity-check` — returns available treatment capacity.
- `funding.assess` — returns whether advance payment is required.
- `payment.request` — returns a payment status.
- `payment.status.request` — returns a provider payment status.

For payment exceptions, the worker supplies the initial provider status only.
The subsequent human payment-resolution form controls whether the process
confirms treatment, retries payment, uses an urgent override, or closes the
booking.

Environment variables:

`.env.example` lists the complete configuration set. The worker has no package
dependencies and does not load that file automatically; set the chosen values
in the PowerShell session before starting it, for example:

```powershell
$env:CAMUNDA_API_URL = 'http://localhost:8080/v2'
$env:DEMO_SLOT_FOUND = 'true'
$env:DEMO_WITHIN_TWO_WEEKS = 'false'
$env:DEMO_ADVANCE_PAYMENT_REQUIRED = 'false'
$env:DEMO_PAYMENT_STATUS = 'completed'
node .\workers\referral-service-worker.mjs
```

Start an integrated process instance by publishing the `Referral received`
message after deploying the BPMN and form files:

```powershell
$body = @{
  name = 'Referral received'
  correlationKey = "integrated-$(Get-Date -Format 'yyyyMMddHHmmss')"
  variables = @{ patientId = 'demo-patient-001' }
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:8080/v2/messages/correlation' `
  -ContentType 'application/json' `
  -Body $body
```

This is a demonstration implementation. Replace the deterministic handlers with calls to the real scheduling and correspondence services. It intentionally does not subscribe to `io.camunda.zeebe:userTask`; those represent human work and should use Camunda user tasks and Tasklist.
