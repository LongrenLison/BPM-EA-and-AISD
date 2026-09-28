# Clinic Letter Sprint 02 — 个人部分

本目录只包含Clinic Letter个人流程、表单、模拟Worker、便携本地演示入口和测试记录。它是上传至小组仓库的独立个人模块，尚未接入整合图，不代表已向课程平台提交；模拟发送不是真实信函送达。

案例要求诊疗后七天内完成、批准、处理并发出，让收件人通常在约两周内收到，并未明确要求独立电子回执或十四天确认流程。本版保留现有七天发送及延迟监测设计，没有新增“两周送达”流程。

## 文件入口

| 材料 | 文件 | 用途 |
|---|---|---|
| 正常时间流程 | clinic-letter-sprint02.bpmn | 可编辑流程源文件；7天、每周、1/3日历月设置 |
| 秒级演示流程 | clinic-letter-sprint02-demo.bpmn | 独立10/20/30秒演示；不代替正式业务时间 |
| 清晰流程图 | clinic-letter-preview.png / .svg | 阅读与讲解；可编辑内容仍以.bpmn为准 |
| 可打印流程图 | output/pdf/clinic-letter-sprint02.pdf | A3横向单页，便于打印或放大查看 |
| 四张表单 | forms/ | 起草、临床批准、秘书核对、发送失败重试 |
| 模拟服务处理 | worker.mjs / adapter.mjs | 数据保护、模拟发送、提醒、升级、有限技术重试 |
| 本地运行入口 | local-demo.mjs / audit-history.mjs | 同次部署、API测试、准备练习、限时Worker、追加历史 |
| 状态和测试 | PERSONAL_STATUS.md / TEST_PLAN.md / TEST_RESULTS.md / evidence/ | 已完成、已测试和待测试分开记录 |
| 操作与汇报 | DEMO_RUN_GUIDE.md / YOUR_PART_GUIDE.md / BRIEFING.md | 稍后练习步骤和简短中英说明 |

original-clinic-letter.bpmn和previous-failed-draft.bpmn只留档，不部署失败草稿。本包不附Camunda下载包、数据库或旧的电脑专用运行脚本。export-pdf.py是可选的重复PDF导出工具，需Reportlab/Pypdf；不影响无额外包依赖的Node本地入口。

## 当前个人实现

正常版和秒级版各有22个流程节点、26条顺序流。医生起草并决定收件人角色，医生批准临床内容，秘书只处理行政核对；秘书发现疑似临床问题会返回医生复核。每次重新起草会清除旧批准及行政核对，不能沿用上一轮批准直接发送。

起草表单分别记录信函类型、诊断、临床发现、治疗决定、沟通指示、收件人角色、诊疗摘要及后续计划。收件人是演示角色代码，不是实际联系方式：PATIENT、GP、HEALTHCARE_PROVIDER、OTHER_PROFESSIONAL；多个角色使用逗号分隔且不重复。

五个业务时点为draftStartedAt、draftCompletedAt、approvedAt、administrativeProcessedAt、letterSentAt，发送方式记录为distributionMethod=SIMULATED_LOCAL。起草开始时间表示进入起草阶段，不是医生第一次敲键盘。任务创建/完成日期、延迟理由、返工理由、提醒及升级事件追加到本地evidence/demo-history.jsonl；它不是医院级持久审计系统。

四张表单都有可选delayReason。拒批理由和秘书临床复核理由尚未配置条件必填；练习时有问题应填写说明，不能把“表单可填写”说成“已强制校验”。重试表单的dispatchResolution固定必填。

## Worker的五种工作

| 任务 | 正常版job type |
|---|---|
| 记录起草开始并重置旧批准 | clinic-letter.sprint02.record-draft-start |
| 保护检查后模拟发送 | clinic-letter.sprint02.dispatch |
| 模拟周提醒 | clinic-letter.sprint02.reminder |
| 模拟一个月升级通知 | clinic-letter.sprint02.escalate-one-month |
| 模拟三个月升级通知 | clinic-letter.sprint02.escalate-three-months |

演示版使用相应的clinic-letter.sprint02-demo.*类型，与正常版隔离。业务发送拒绝通过BPMN Error进入处理/授权重试；模拟技术故障走job failure，有限重试后恢复，不把技术失败当成临床拒批。所有通知和发送都是模拟的，不发送邮件，也不代替经理或医生作实际决定。

## 便携本地运行

推荐Node.js 22；已验证的目标为本机Camunda 8 Run 8.9.21。Camunda须先启动并限定本机访问。以下命令在本包目录运行，没有硬编码个人电脑路径：

~~~text
node --test tests/*.test.mjs
node worker.mjs --demo
node local-demo.mjs deploy --local-demo
node local-demo.mjs test --local-demo
~~~

前两条为离线检查；后两条显式修改本地合成数据环境。deploy同次部署两个模型和四表单；test创建并完成自动API测试实例，不自动遗留人工练习实例。最新部署与测试记录为evidence/current-deployment.json、evidence/personal-engine-latest.json，历史记录保留。

稍后需要自己操作时再运行：

~~~text
node local-demo.mjs prepare --local-demo
node local-demo.mjs worker --local-demo --minutes 15
~~~

prepare创建一个新练习实例；worker处理登记的个人演示服务任务，15分钟后停止，不替你填写表单。--minutes 15必须分成两个参数，不是--minutes15。没有--local-demo就停止，Worker时长只接受1—30分钟。不使用SaaS、远端地址或凭据。

如有活动演示实例、未登记实例、源与部署不匹配或现存运行锁，脚本会拒绝继续；它不会自动取消实例、结束其他进程或删除未知锁。先检查原因，不重复创建任务。详细步骤见DEMO_RUN_GUIDE.md。

## 当前验证结果

2026-09-28北京时间09:09—09:10：55个离线测试通过，8个新版本地引擎API场景通过；8个实例均COMPLETED且无活动待办/事故，完成后等待11秒无五类演示job残留。对应部署key为2251799813691856，演示模型版本2。精确源指纹和实例见TEST_RESULTS.md及evidence/personal-engine-latest.json，不扩大为全部UI或生产验收。

旧版v1正常路径已完成Tasklist手动练习；当前新增字段、秘书临床退回及新版异常表单界面尚待练习。自动API测试与界面练习分开记录。

## 时间和局限

正常版从consultationCompletedAt计算7天、1/3日历月；P1M/P3M不是30/90天。秒级版以启动后的10/20/30秒代替等待。引擎异步运行，不能保证恰好在该秒点显示。

批准后周提醒处理被抑制；月度通知分支仍保持到发送成功，成功发送取消当前信函流程中的剩余监测。外部已发送或在途通知不会因此撤回。提醒停止与升级继续的口径仍需在最终业务验收中确认。

真实邮件/通知、角色权限、正式长周期及月末/时区边界、生产幂等与在途竞态、小组集成尚未验收。本模型用服务任务表达请求/完成，没有新增跨流程消息关联；不声称所有消息事件已实现。
