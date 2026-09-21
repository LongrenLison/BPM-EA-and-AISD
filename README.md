# Hospital Patient Administration System

Initial Sprint 1 BPMN increment for the hospital referral, treatment and administration case study.

## Models

| File | Purpose | Executable |
|---|---|---|
| `models/00-entities-and-collaboration.bpmn` | Stakeholder collaboration map: all hospital roles are lanes and independent external parties are pools. | No |
| `models/01-referral-and-first-appointment.bpmn` | Receive, clinically review, accept and book a new referral. | Yes |
| `models/02-treatment-booking-and-funding.bpmn` | Authorise treatment, obtain capacity/funding, and manage payment outcomes. | Yes |
| `models/03-patient-enquiry-routing.bpmn` | Classify patient contact and route administrative, financial and clinical enquiries. | Yes |
| `models/04-clinic-letter-monitoring.bpmn` | Author, approve, distribute and monitor clinic letters. | Yes |

Open any model in Camunda Modeler. The executable models use Camunda 8 Zeebe job types for simulated external services. Workers and Camunda Forms will be added in the next implementation increment.

## Responsibility boundaries

Clinical acceptance, treatment consent, treatment modification, and clinical advice are assigned only to clinical lanes. Finance owns funding, payment and refund decisions. Administrative lanes coordinate records, communications and scheduling but do not make clinical or financial decisions.

## Simulation job types

`referral.request-information`, `scheduling.search`, `scheduling.reserve`, `correspondence.dispatch`, `treatment.capacity-check`, `funding.assess`, `payment.request`, `clinic-letter.distribute`

Each worker must return a correlation-safe result keyed by `patientId` and the relevant business reference (for example, `referralId`, `treatmentRequestId` or `paymentReference`). Payment workers must treat a missing provider confirmation as `investigate`, never as a failed payment requiring automatic retry.
