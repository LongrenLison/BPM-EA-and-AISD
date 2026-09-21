# 医院患者管理系统 中文对照

本目录是英文 BPMN 源文件的中文阅读版。英文 `.bpmn` 文件仍是 Camunda Modeler 中打开、部署和后续连接 Forms/Workers 的唯一源文件；本目录不改变任何元素 ID、变量或 Zeebe worker 类型。

| 英文源文件 | 中文对照文件 | 用途 |
|---|---|---|
| `models/00-entities-and-collaboration.bpmn` | `00-实体与协作总览-中文对照.md` | 查看参与者、泳池和职责 |
| `models/01-referral-and-first-appointment.bpmn` | `01-转诊与首诊预约-中文对照.md` | 查看转诊和预约流程 |
| `models/02-treatment-booking-and-funding.bpmn` | `02-治疗预约与资金安排-中文对照.md` | 查看治疗、资金与支付流程 |
| `models/03-patient-enquiry-routing.bpmn` | `03-患者咨询分流-中文对照.md` | 查看咨询分流流程 |

阅读方式：在 Camunda Modeler 打开英文 BPMN，同时打开对应中文文件；按元素名称逐行对照。`patientId`、`referralId`、`treatmentRequestId`、`paymentReference` 和 worker type 等技术字段保持英文，以避免部署或后续开发时出现不一致。
