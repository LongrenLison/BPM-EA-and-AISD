# 患者咨询独立流程

此目录是 `models/16-core-patient-enquiries.bpmn` 的独立运行副本。Camunda 中的流程 ID 为 `Hospital_Enquiry_Standalone`，原流程 `Hospital_Enquiry` 仍留在原工程中。流程名称为 **07 Patient enquiry and clinical triage — standalone**。

在 Camunda Modeler 中请打开此目录下的 `F:\BPM-EA-and-AISD\patient-enquiries-package\16-core-patient-enquiries-standalone.bpmn`。`F:\BPM-EA-and-AISD\models\16-core-patient-enquiries.bpmn` 是原图，没有外部黑盒池。若 Modeler 已打开旧标签页，关闭旧标签并重新打开上述完整路径。外部黑盒位于医院流程池上方，虚线 Message Flow 指向 `Q_Start`。

## 文件与运行关系

| 文件 | 用途 |
| --- | --- |
| `16-core-patient-enquiries-standalone.bpmn` | 可执行流程、外部黑盒池、Message Flow、泳道与网关；支持 Tasklist 手动启动和独立消息启动 |
| `forms/h-enquiry-intake.form` | 启动表单及 `Q_Record` 登记、分类表单 |
| `forms/h-enquiry-triage.form` | `Q_Triage` 临床分诊表单 |
| `forms/h-enquiry-response.form` | 行政、预约、财务、临床答复表单 |
| `java/src/main/java/io/camunda/demo/enquiry/HospitalEnquiryWorker.java` | 处理本流程两个 Service Task 的 Java worker |
| `java/src/main/java/io/camunda/demo/enquiry/HospitalDemoLedger.java` | 本地演示审计记录的幂等收据 |
| `java/src/main/java/io/camunda/demo/enquiry/EnquiryApplication.java` | Spring Boot 启动类 |
| `workers/external-enquiry-message-worker.mjs` | 外部咨询来源的按需消息发送适配程序 |
| `java/pom.xml`、`java/src/main/resources/application.properties` | Maven 项目和本地 Camunda 连接配置 |
| `deploy.ps1`、`start-worker.ps1`、`verify.mjs` | 校验部署、启动 worker、端到端验证 |

外部黑盒池 `Participant_ExternalEnquiry` 通过虚线 Message Flow 指向 `Q_Start`。消息名为 `Patient enquiry received (standalone)`，与消息开始事件一致，避免原流程收到同一条消息。黑盒池不包含可执行任务，因此不需要另一个 Camunda JobWorker；`workers/` 下的程序是外部消息发送端。`Q_Init` 使用 `hospital.enquiry.initialize`；`Q_Notify` 使用 `hospital.enquiry.audit.record`，均由本目录的 Java worker 处理。新 job type 不与原医院 worker 冲突。原图的顺序流、任务表单和业务分支保留。这里没有 Call Activity，也不需要部署其他 BPMN 才能完成咨询分支。

## 部署与启动

本地 C8Run 需要在 `http://localhost:8080` 运行。此目录的 BPMN 和 3 个表单必须在**同一次部署**中上传，因表单采用 `deployment` 绑定：

```powershell
Set-Location 'F:\BPM-EA-and-AISD\patient-enquiries-package'
./deploy.ps1 -ValidateOnly
./deploy.ps1
```

Java 源码用 JDK 22、Maven 编译。当前目录已构建出 `java/target/hospital-patient-enquiries-worker-0.0.1-SNAPSHOT.jar`；修改源码后在 `java/` 下重新执行 `mvn package`，或使用 IntelliJ 自带 Maven。启动 worker：

```powershell
./start-worker.ps1
```

脚本检查本地 Camunda 连通性，只启动本目录的 JAR，写入 `worker.pid`，日志保存在 `logs/`。`java/data/enquiry-demo-ledger/` 保存本地演示审计收据。该 worker 不发送真实患者通知，也不接入真实医院系统；泳道和人员 ID 不会自动配置权限。

打开 [Tasklist Processes](http://localhost:8080/tasklist/processes)，搜索 `Hospital_Enquiry_Standalone` 或上述流程名称，填写 `h-enquiry-intake` 启动表单。提交后，`Q_Record` 人工任务出现在 Tasklist；后续按咨询类型进入相应答复或临床分诊任务。本地演示登录通常是 `demo` / `demo`。若导航栏没有 Processes 入口，直接打开上述地址。

要通过图上的 Message Flow 启动流程，在此目录执行：

```powershell
node ./workers/external-enquiry-message-worker.mjs
```

默认命令发送一条合成患者消息，打印新流程实例键值。也可以用 `--file <JSON文件>` 指定消息变量；文件至少需要非空字符串 `patientId`，可包含 `journeyId`、`enquiryType` 等字段。发送端以 `journeyId` 为 correlation key；若未提供则自动生成。每次真实发送应使用不同的 `journeyId`。消息开始事件会启动新实例，Java worker 执行 `Q_Init` 后，`Q_Record` 出现在 Tasklist。此发送程序按需运行一次，不监听真实外部系统。

## 已验证

`node verify.mjs` 会用合成患者 ID 创建三条测试实例：行政咨询完成，紧急临床咨询未解决后重新登记并完成，以及外部消息启动预约咨询并完成。脚本只提交人工任务，两个 Service Task 由独立 Java worker 执行。`node verify.mjs --leave-open` 还会留下一条处于 `Q_Record` 的实例供 Tasklist 查看。结果写入 `verification-last.json`。这些测试实例仅用于本地演示。

本次已将含外部黑盒池和 Message Flow 的独立流程 v5 与 3 个表单部署到本地引擎，部署信息见 `deployment-last.json`。三条端到端测试均已完成；另用发送程序启动了实例 `2251799814241355`，其 `Q_Record` 任务键为 `2251799814241372`，可在 Tasklist 查看。原流程文件未修改。以后改动此独立目录不会自动同步到原工程，重新部署会产生新版本；已启动实例仍使用创建时的版本。
