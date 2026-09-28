# 02 治疗预约与资金 BPMN（修改版）

本目录是修改版交付包。用户提供的原始 BPMN 文件未覆盖。

## 组内合并说明

这是独立的 02 流程贡献，放在 `contributions/` 供审阅。仓库原有的 `models/00-integrated-hospital-patient-administration.bpmn`、`forms/` 和 `workers/` 均未修改；本分支合入后，也不会自动更新组员的总流程。若最终只交一张总图，需由组内将这里的治疗预约、付款消息、容量错误和重试逻辑按现有总流程的 ID 与变量映射进去，再部署核对。

本目录的 Worker 与仓库根目录的 Worker 订阅了部分相同的 job type。演示本独立流程时，请只运行本目录的 Worker；不要同时运行两个 Worker，以免不同演示规则竞争同一任务。

## 文件

- `02-treatment-booking-and-funding-payment-investigation-follow-up.bpmn`：修改后的 BPMN 流程。
- `forms/`：ZIP 中提供的六个表单，以及新增的 `treatment-payment-issue-notification.form`。新表单只用于支付失败通知和显式重试批准。
- `workers/referral-service-worker.mjs`：保留原 Worker 的其他处理器，补全本流程所需的容量错误、容量结果、支付幂等键和 PSP 状态消息处理。
- `deploy-local.mjs`：向本地 Camunda 8 REST API 一次部署 BPMN 和全部表单。

## 流程修改

1. 七个实际 BPMN `userTask` 都配置为 Camunda User Task，并绑定表单：
   - `AuthoriseRequest` → `treatment-authorisation`
   - `FundingDecision` → `treatment-funding-decision`
   - `ConfirmTreatment` → `treatment-appointment-confirmation`
   - `PendingExternal` → `hospital-task-update`
   - `UrgentOverride` → `treatment-urgent-override`
   - `InvestigatePayment` → `treatment-payment-investigation`
   - `NotifyPaymentIssue` → `treatment-payment-issue-notification`
2. 容量查询后新增 `CapacityAvailable` 网关：返回 `true` 才进入资金评估；返回 `false` 进入现有待处理任务及 `PT30M` 重试。服务抛出 `EXTERNAL_UNAVAILABLE` 时，由已声明且代码匹配的 BPMN 错误边界事件进入同一待处理路径。
3. PSP 状态消息使用 `paymentCorrelationKey` 关联。Worker 发布的消息名与 BPMN 声明一致；短 TTL 用于处理消息先于等待订阅到达的情况。Worker 将 PSP 回执写入 `providerPaymentStatus`；业务分支只读该字段，避免把可编辑表单中的 `paymentStatus` 当成 PSP 回执。
4. 对 `completed`、`investigate`、`declined/cancelled` 和 `urgent` 状态补齐显式网关条件。
5. 拒付/取消后不再直接重新请求付款。只有 PSP 回执为 `declined` 或 `cancelled`，且 Finance 在失败通知表单明确勾选 `paymentRetryAuthorised`，流程才进入第二次付款任务；未勾选时到 `E_PaymentHold` 结束。批准字段单独放在失败通知表单，调查表单不含该字段，避免 PSP 查询完成前提前授权。
6. 原有 Clinical、Booking、Finance 泳道和消息流保留。输入材料没有提供 Camunda `candidateUsers`/`candidateGroups` 配置；泳道名称是角色分工，不能单独证明 Tasklist 权限限制已配置。

## Worker 与运行

本流程的四个服务任务与 Worker 类型一致：

| BPMN 服务任务 | Worker job type |
| --- | --- |
| `CheckCapacity` | `treatment.capacity-check` |
| `AssessFunding` | `funding.assess` |
| `TakePayment` | `payment.request` |
| `RequestPaymentStatus` | `payment.status.request` |

本地 Camunda 8 在 `http://localhost:8080` 启动后，在本目录运行：

```powershell
node .\deploy-local.mjs
node .\workers\referral-service-worker.mjs
```

演示配置通过环境变量设置：`DEMO_CAPACITY_AVAILABLE=false` 模拟无容量；`DEMO_EXTERNAL_UNAVAILABLE=true` 模拟服务故障；`DEMO_ADVANCE_PAYMENT_REQUIRED=true` 走预付款；`DEMO_PAYMENT_STATUS=investigate` 加 `DEMO_PROVIDER_STATUS=completed` 模拟先无确认、后收到 PSP 状态。

Worker 是确定性演示实现，不会真实收费或查询真实 PSP。它为同一个付款 job 生成稳定幂等键；真实 PSP adapter 必须把该键传给 PSP，并核实 PSP 的幂等范围和响应语义。新的、经人工批准的付款尝试使用新的 job 键。

## 验证

- BPMN XML 可解析；ID、任务、连线、消息和错误引用已静态检查。
- 已部署到本地 Camunda 8.9，流程定义 `Process_Treatment`，最终部署版本为 **7**；BPMN 和七个表单均被引擎接受。
- Tasklist 用户任务 REST 表单接口为全部七个任务返回了正确表单 ID 和可读取的表单 JSON schema；本次没有核验浏览器中的视觉排版。
- 已运行验证：未授权终止、无预付款正常完成、紧急覆盖完成、付款状态查询后消息关联并完成、容量返回 `false` 后等待重试、容量 Worker 抛出 BPMN 错误后等待重试、拒付后未授权时只产生一次付款任务，以及授权后才创建第二个付款任务。
- `PT30M` 计时器已验证为活动状态；为避免测试实例等待半小时，验证后取消了测试实例。

## 待向 Tutor/Stakeholder 确认

- `treatmentCapacityAvailable=false` 是否应沿用现有“待处理、30 分钟后重试”路径。
- 谁可批准付款重试，以及 PSP 必须提供何种“未收款”证据；这决定 `paymentRetryAuthorised` 的授权权限和填表规则。
- 真实 PSP 对 `declined`、`cancelled` 的定义、幂等键范围和重试语义。演示 Worker 本身不能证明真实环境不会重复扣款。
- 若需要按角色限制 Tasklist 访问，请提供各泳道对应的实际 Camunda 用户组/候选组；这些信息不在所给材料中。
