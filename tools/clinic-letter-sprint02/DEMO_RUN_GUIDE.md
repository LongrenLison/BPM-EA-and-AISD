# Clinic Letter本地演示步骤

旧版v1正常路径已练习完成。新版增加结构化内容和秘书临床退回，界面尚待练习；按你的安排，暂不创建人工任务。下面命令等你准备练习时再运行。

## 先确认环境

- 推荐Node.js 22，目标为已验证的本机Camunda 8 Run 8.9.21。
- Camunda须先启动并限定本机访问；启动窗口保持打开，不把服务开放到网络。
- 以下命令在此材料包目录运行。脚本使用相对路径，不需要旧local-runtime目录里的专用脚本。
- 打开http://localhost:8080/tasklist。若本地环境显示登录页，用demo / demo，不是UWE账号，不保存密码。

服务是否在线须现场确认，准备时的历史记录不代表它一直运行。旧完成实例不能再次领取，“没有待办”也不能单独证明成功结束。

## 部署及自动API测试

~~~text
node --test tests/*.test.mjs
node local-demo.mjs deploy --local-demo
node local-demo.mjs test --local-demo
~~~

第一条离线检查。deploy同次部署正常版、秒级版和四表单；test创建合成实例，自动执行个人API场景并写入evidence/personal-engine-latest.json。测试不遗留人工练习实例，不需要边跑测试边填表。本次对应源的离线55/55、引擎API 8/8已通过，重新测试仍需依据实际输出判断。

仅修改文档不用重新部署；修改模型、表单、Worker或适配器后须先显式部署。若有活动演示实例，先完成或检查它，不重复运行test/prepare。脚本不会自动取消实例。

## 稍后开始自己的界面练习

在包目录运行：

~~~text
node local-demo.mjs prepare --local-demo
node local-demo.mjs worker --local-demo --minutes 15
~~~

第一条创建一个合成练习实例并等待Draft就绪，显示实例key。第二条启动限时Worker，处理登记的个人演示服务任务并追加历史，15分钟后自动停止。--minutes 15是正确语法，不能连写为--minutes15。

Worker不替你填写表单，不发送真实邮件；到时停止后，新的服务任务可能等待。需要时再显式开启Worker，不把“没有用户任务”当成模拟发送成功。Ctrl+C可停止Worker，不要误关Camunda启动窗口。

## 新版正常路径

每次打开任务先点Assign to me。全部填写合成数据，不放姓名、病历、联系方式。

1. **Consultant drafts Clinic Letter**：保持DEMO编号；选择New Patient或Follow-up类型。诊断、发现、治疗决定、沟通指示、摘要和后续计划可分别写Synthetic diagnosis、Synthetic findings、Synthetic treatment decision、Synthetic communication instructions、Synthetic consultation summary、Synthetic follow-up arrangement。收件人角色用PATIENT,GP，不是邮箱。延迟理由没有则留空，然后Complete Task。
2. **Consultant clinically approves**：查看全部起草内容，勾选Clinically approved，拒绝原因留空，再完成。
3. **Secretary checks recipients / admin details**：正常路径不勾Suspected clinical error，勾两项行政核对，再完成。
4. Worker模拟发送后检查实例COMPLETED、无活动事故/待办、dispatchStatus=SIMULATED_SENT。可在Operate查实例，测试证据看对应JSON；仅Tasklist空列表不够。

## 返工与发送错误

- **医生拒批**：审批不勾批准，写合成拒绝理由后完成，应回起草；旧批准被清除，修改后须重新审批。
- **秘书临床疑问**：在Admin勾Suspected clinical error，写复核原因后完成，应回医生起草；秘书不能自己批准临床内容。
- **行政缺项**：不勾其中一项核对且无临床疑问，应留在秘书行政返工。
- **业务发送错误**：自动API测试已包含simulateDispatchError=true场景。便携prepare目前创建默认正常实例，不能凭空期待它出现Retry。后续定向界面练习需明确创建相应测试输入；不要编辑历史JSON冒充执行。
- **Retry表单**：写Resolution / action recorded，取消模拟拒绝标志，勾授权重试。未授权则继续待处理。
- **技术失败**：API测试用两次模拟瞬时失败检查有限重试；与BPMN业务错误不是同一路径。

四张表单的延迟理由为可选；拒批及临床复核理由未做条件必填，但演示问题时应写清原因。Retry的处理说明固定必填。

## 延迟与历史

留在起草时，秒级版10/20/30秒分别产生提醒、一个月升级、三个月升级的模拟服务任务，升级不会替医生批准或结束临床工作。引擎异步，不保证恰好在该秒点可见。批准后周提醒处理被抑制，月度通知分支仍保持到发送；发送成功终止当前实例监测。

正式版是7天、每周、1/3日历月，不能将秒级通过写成正式长时间验证。本地evidence/demo-history.jsonl追加任务日期、理由、提醒/升级和发送事件；五个业务时点另写入实例元数据。起草开始表示进入阶段，不是实际键盘操作时间。

## 遇到拒绝继续时

若脚本报告活动实例、源与部署不匹配、未登记实例或运行锁，先看错误和已有实例，不重复运行、强删锁或结束未知进程。入口默认关闭，仅在完整参数包含--local-demo时操作本机环境；没有远端、凭据或真实通信支持。

实际通过与待测试范围看TEST_RESULTS.md，简短讲解看BRIEFING.md，小组整合暂不处理。
