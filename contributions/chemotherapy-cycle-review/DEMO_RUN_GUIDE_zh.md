# 化疗周期流程 Camunda 8 演示指南

## 演示目标

用 Camunda Modeler 展示流程图和节点说明，再用 Camunda 8 的 Tasklist 完成人工任务，用 Node.js Worker 模拟检查结果、排期和患者通知三个外部服务。Worker 只模拟接口响应，不连接真实医院系统。

## 开始前

需要 Camunda 8 本地环境（C8Run 或小组提供的集群）运行，并能访问 `http://localhost:8080/v2`。本机目前只有 Camunda Modeler，检查时 8080 和 26500 端口都未运行，因此现场部署前要先启动小组使用的 Camunda 8 引擎。

## 现场操作顺序

1. 在 Camunda Modeler 打开 `chemotherapy-cycle-review-optimized.bpmn`（最终优化版）。从左到右讲解主流程：请求化验结果、临床审查、继续/延期/修改治疗、排期、Finance 影响判断和患者通知。点击任务，在属性栏的 Documentation 中展示该步骤的具体操作。延期分支要强调：紧急安全暂停之后必须经过后续临床授权判断；取消或授权不完整时保留暂停状态且不改排期。
2. 在 Modeler 中选择连接到本地或小组 Camunda 8 环境，然后部署 BPMN 和 `forms` 文件夹里的九个 `.form` 表单。确认部署成功。
3. 在一个终端运行 Worker：

   ```powershell
   $env:CAMUNDA_API_URL = 'http://localhost:8080/v2'
   $env:DEMO_RESULTS_AVAILABLE = 'true'
   $env:DEMO_SCHEDULE_UPDATED = 'true'
   $env:DEMO_NOTIFICATION_SENT = 'true'
   node .\workers\chemotherapy-cycle-worker.mjs
   ```

   运行前先在 PowerShell 中切换到本成果包目录；也可以在该目录的地址栏输入 `powershell` 打开终端。这样无需依赖某一台电脑上的绝对路径。

   看到 `Worker ... is listening` 表示 Worker 已启动。它订阅三个 `zeebe:taskDefinition` 中声明的 Job Type，并将模拟变量返回给流程。Worker 终端保持运行。

4. 在浏览器打开 `http://localhost:8080/tasklist`，启动 `Chemotherapy Cycle Review and Treatment Modification` 流程。周期复核入口变量设为 `requestType=cycleReview`；独立修改申请入口设为 `requestType=treatmentModification`。缺少或未知类型会安全结束且不改排期。
5. 等 Worker 返回 `resultsAvailable=true`。在 Tasklist 完成 `Review results and patient condition` 表单：填写检查结果和临床理由，选择 `continue`，并把 `urgentPostponement` 留空或设为 false。
6. 完成 `Authorise next cycle` 人工任务。Worker 返回 `scheduleUpdated=true`，Finance 网关走无财务影响路径，随后由 Worker 模拟患者通知。流程到达结束事件。

## 异常场景演示

从 Tasklist 再启动一个流程实例。临床审查表单选择 `change`，随后在正式修改表单中将 `formalRequest` 或 `modificationAuthorised` 设为 false，再完成任务。流程应到达 `Change rejected; schedule unchanged`，不能进入排期任务。向老师说明这是未正式授权修改的拒绝路径。

还可演示紧急延期的拒绝路径：选择延期并记录安全原因，完成紧急暂停后，在后续授权表单选择 `cancel`，或未填写授权人/授权时间。流程应到达 `Urgent hold retained; no schedule change`；暂停继续有效，不能进入正式修改或排期。只有 `confirm` / `amend` 且 `followUpAuthorised=true` 才会继续进入正式修改审核。

也可以演示结果缺失：停止 Worker，在新终端把 `DEMO_RESULTS_AVAILABLE` 设为 `false` 后重启 Worker，再启动流程。Worker 返回 `resultsAvailable=false`，流程进入 `Keep booking pending; investigate` 人工任务，不得进入临床审查或排期。检查并记录原因后完成重试任务；若要让重试成功，先停止 Worker，再用 `DEMO_RESULTS_AVAILABLE=true` 重启它。

## 如何解释 Worker 代码

打开 `workers/chemotherapy-cycle-worker.mjs`：

- `handlers` 将 BPMN 的 Job Type 映射到模拟服务结果。
- `handleOne` 向 Camunda 8 请求一个对应 Job，调用处理器并把返回变量提交完成。
- `poll` 轮询三个 Job Type：`clinical-results.request`、`chemotherapy.schedule-update`、`correspondence.notify-cycle-plan`。
- 流程用 FEEL 条件读取 `resultsAvailable`、`scheduleUpdated` 等变量选择网关路径。
- 临床审查、正式修改和 Finance 决定仍是 User Task，由人通过 Tasklist 完成；Worker 不代替临床或 Finance 人员做决定。

## 组内权限和真实接口说明

泳道和任务名称标出临床、排期和 Finance 责任边界。此演示包没有接入小组的 Identity 用户组，因此需要在正式演示环境中配置 Tasklist 用户权限，才能把角色边界变成系统强制控制。实验室、排期和通知都是确定性 mock Worker；真实接口、重试策略和结果映射仍需接入与确认。

## 今天的简短汇报

> I am responsible for the chemotherapy cycle review and treatment modification process. I prepared an executable Camunda 8 BPMN, nine task forms and a Node.js Worker for laboratory results, treatment scheduling and correspondence. The model separates clinical decisions from booking and Finance work, and checks authorisation before a schedule change. I completed 48 model-level checks, including normal and exception routes. Live Camunda end-to-end execution is still pending because the Camunda engine is not running on this computer; the Worker currently returns mock responses, and Tasklist role groups and real external interfaces still need configuration.
