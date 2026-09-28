/*
 * 本地演示用 Worker，负责处理化疗周期流程中的外部服务任务。
 * 临床、排期和财务等人工步骤仍由 BPMN 用户任务交给 Tasklist 中的人完成。
 * 本 Worker 只返回模拟结果，不会连接真实医院系统或处理真实患者数据。
 */

const apiBase = (process.env.CAMUNDA_API_URL ?? 'http://localhost:8080/v2').replace(/\/$/, ''); // 读取 Camunda API 地址，未设置时使用本机演示地址，并去掉末尾斜杠。
const workerName = process.env.WORKER_ID ?? 'chemotherapy-cycle-worker'; // 读取 Worker 名称，未设置时使用默认名称。
const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? 1_000); // 读取轮询间隔（毫秒），默认每秒检查一次任务。

function envBoolean(name, defaultValue) { // 把环境变量安全地转换为布尔值 true/false。
  const value = process.env[name]; // 按传入的变量名读取环境变量。
  if (value === undefined) return defaultValue; // 没设置该变量时，返回调用方给的默认值。
  return value.toLowerCase() === 'true'; // 只有文本“true”（不区分大小写）才算 true。
}

const handlers = { // 建立“Camunda Job Type 到模拟处理函数”的对应表。
  // 结果查询任务：用演示变量模拟外部检验系统的返回值。
  'clinical-results.request': async () => ({
    resultsAvailable: envBoolean('DEMO_RESULTS_AVAILABLE', true), // 表示检验结果是否齐全。
    resultReference: 'LAB-DEMO-001' // 固定的模拟结果编号，不是真实患者数据。
  }),
  // 排程更新任务：用演示变量模拟预约/治疗排程服务。
  'chemotherapy.schedule-update': async () => ({
    scheduleUpdated: envBoolean('DEMO_SCHEDULE_UPDATED', true), // 表示排程更新是否成功。
    scheduleReference: 'CYCLE-DEMO-001' // 固定的模拟排程编号。
  }),
  // 患者通知任务：用演示变量模拟通知服务。
  'correspondence.notify-cycle-plan': async () => ({
    notificationSent: envBoolean('DEMO_NOTIFICATION_SENT', true), // 表示通知是否发送成功。
    notificationReference: 'NOTICE-DEMO-001' // 固定的模拟通知编号。
  })
};

async function request(path, options = {}) { // 统一封装发往 Camunda REST API 的 HTTP 请求。
  const response = await fetch(`${apiBase}${path}`, { // 向 Camunda 的 API 地址发送 HTTP 请求。
    ...options, // 合并调用方传入的请求方法、请求体等配置。
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) } // 默认声明 JSON，同时保留调用方传入的其他请求头。
  });
  if (!response.ok) { // HTTP 状态不是 2xx 时，说明 API 请求失败。
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}: ${await response.text()}`); // 抛出包含状态码和错误正文的信息，便于排查。
  }
  return response.status === 204 ? undefined : response.json(); // 204 表示成功但没有响应正文；其他成功响应按 JSON 解析。
}

async function handleOne(jobType, handler) { // 针对一种任务类型领取并完成最多一个 Camunda Job。
  const activation = await request('/jobs/activation', { // 请求 Camunda 激活一个该类型的任务。
    method: 'POST', // 使用 POST 请求领取可执行的任务。
    body: JSON.stringify({
      type: jobType, // 告诉 Camunda 当前要领取哪种任务。
      worker: workerName, // 标识处理该任务的 Worker。
      timeout: 30_000, // 领取后的锁定时间为 30 秒。
      maxJobsToActivate: 1, // 每次最多领取一个，便于演示和控制。
      requestTimeout: -1 // 允许请求等待任务出现。
    })
  });

  const job = activation.jobs?.[0]; // 从返回结果中取第一个任务；?. 可避免 jobs 不存在时报错。
  if (!job) return; // 没有可处理的任务时直接结束本轮。
  const variables = await handler(job); // 调用该任务类型对应的模拟处理器，生成流程变量。
  await request(`/jobs/${job.jobKey}/completion`, { // 使用任务编号调用完成接口。
    method: 'POST', // 使用 POST 提交任务完成结果。
    body: JSON.stringify({ variables }) // 把处理结果提交回 Camunda，让流程继续往下走。
  });
  console.log(`[${new Date().toISOString()}] completed ${job.elementId} (${jobType}), job=${job.jobKey}`, variables); // 在终端记录完成时间、节点、任务编号和返回变量。
}

async function poll() { // 扫描所有已注册的任务类型。
  for (const [jobType, handler] of Object.entries(handlers)) { // 将处理器对象拆成“任务类型 + 处理函数”。
    await handleOne(jobType, handler); // 依次领取并处理任务，等待当前类型处理完再继续。
  }
}

console.log(`Worker ${workerName} is listening at ${apiBase} for: ${Object.keys(handlers).join(', ')}`); // 显示 Worker 的 API 地址和监听的任务类型。
setInterval(() => { // 创建定时器，让 Worker 按固定间隔持续检查新任务。
  poll().catch((error) => console.error(`[${new Date().toISOString()}] ${error.message}`)); // 定时轮询；捕获错误并打印，避免未处理的 Promise 错误。
}, pollIntervalMs); // 按配置的间隔重复执行轮询。
void poll(); // 启动时立即先轮询一次，不必等第一个定时周期。
