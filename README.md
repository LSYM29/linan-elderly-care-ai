# 邻安社区养老服务系统 AI 助手

基于 Node.js、Express 和 MySQL 的社区养老服务系统，集成知识库问答、业务工具查询和确认式预约。后端通过标准 HTTPS API 调用 DeepSeek，默认模型为 `deepseek-flash`。

## 功能

- 业务管理：用户与老人档案、服务项目、订单履约、评价、紧急求助和社区公告。
- 知识问答：导入 TXT、Markdown 和文字型 PDF，按章节切块，结合中文分词与 BM25 检索，按地区、日期和启用状态过滤资料，展示引用原文。
- 工具调用：使用原生 `tool_calls` 查询真实服务、当前账号档案及授权订单，并生成预约草稿。
- 预约确认：草稿有效期 15 分钟，支持修改和取消；正式提交需点击确认按钮，后端重新校验并在事务内创建订单与日志。
- 运行记录：保存模型、提示词和知识版本、工具轨迹、耗时、Token 用量及失败原因，管理员可查看评测汇总。

## 环境与安装

需要 Node.js 22.13 或以上版本、MySQL 8，以及可调用的 DeepSeek API Key。PDF.js 是项目依赖，随 `npm ci` 安装。

在项目目录执行：

```sh
npm ci
node scripts/setup-env.js
npm run init-db
npm run init-ai
npm run config:api
npm start
```

配置向导会询问本机 MySQL 密码，并生成本地 `.env` 与随机 Session 密钥。默认地址为 <http://127.0.0.1:3002>，仅监听本机；修改配置后需重启服务。

Windows 也可以双击 `启动系统.bat` 完成配置、依赖安装、数据库初始化和启动；双击 `配置API密钥.bat` 在输入框中粘贴密钥并保存。macOS 和 Linux 使用上述终端命令。

## 配置

配置示例见 `.env.example`。真实密钥只由后端读取，不能写入前端代码或提交到仓库。

| 配置项 | 默认值或用途 |
| --- | --- |
| `PORT` | `3002` |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_PASSWORD` | 本机 MySQL 账号与密码 |
| `DB_NAME` | `linan_ai_api` |
| `SESSION_SECRET` | 配置向导生成的随机密钥 |
| `AI_PROVIDER` | `deepseek` |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` |
| `AI_MODEL` | `deepseek-flash` |
| `DEEPSEEK_API_KEY` | 在本地配置，不提供预置密钥 |
| `AI_TIMEOUT_MS` | `45000`，单次模型调用总时限 |
| `AI_MAX_TOKENS` | `2048` |
| `AI_RETRIES` | `1`，可设为 `0` 关闭重试 |

数据库名限制在独立命名空间：运行库为 `linan_ai_api` 或其允许的后缀形式，测试库为 `linan_ai_test_api` 或其允许的后缀形式。连接池和初始化入口均校验数据库名称，拒绝访问其他数据库。数据库会话和预约时间使用北京时间。

缺少模型密钥时，普通业务仍可运行；智能助手显示配置提示。401、402、429、网络错误和超时有独立错误提示；临时网络、限流及服务异常最多重试一次，重试仍受调用总时限约束。

## 演示账号与使用示例

初始化脚本提供合成演示数据：

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 家属 | `family` | `family123` |
| 管理员 | `admin` | `admin123` |
| 护理人员 | `caregiver` | `caregiver123` |

家属登录后打开“AI 服务助手”，可尝试：

1. “预约后什么情况下可以取消？”——查看资料引用。
2. “有哪些可以预约的服务？”——查询当前启用项目和价格。
3. “我的预约进度怎么样？”——查询当前账号有权访问的记录。
4. 提供具体服务、未来的日期时刻和详细地址——生成待确认草稿。
5. 核对卡片并点击“确认预约”——后端复核后创建正式订单。

只说“明天下午”等信息不完整的需求需要补充明确时刻和地址。聊天中的“确认”不会直接创建订单。管理员还可导入资料、管理资料状态并查看运行与评测。

## 架构与权限

请求链路：网页 → Express 登录 Session → 资料检索与工具编排 → DeepSeek API → 后端校验与业务执行 → 页面展示。

| 工具 | 用途 |
| --- | --- |
| `search_knowledge` | 检索当前地区适用的知识资料 |
| `list_services` | 查询启用服务和当前价格 |
| `get_my_elder_profile` | 查询当前家属绑定的老人基本档案 |
| `list_my_orders` | 查询当前账号授权范围内的订单或任务 |
| `get_order_detail` | 查询有权访问的订单详情与履约记录 |
| `prepare_booking` | 生成待确认预约草稿 |

用户身份从 Session 获取，不由模型参数决定。家属只能查询自己的订单，护理人员只能查询分配给自己的任务，管理员按管理权限查询。工具名称、参数类型和允许字段均由服务端校验；不向模型提供 SQL、文件、系统命令或正式下单工具。

普通预约与 AI 确认共用订单业务函数。确认接口复查草稿归属、修订号、有效期、服务启用状态、时间和价格快照，使用事务与行锁控制重复提交；订单和状态日志任一步失败均回滚。

知识库复用 `ai_faqs`，文档及片段保存在 `ai_documents`、`ai_chunks`。检索采用 BM25，未使用 Embedding 服务或向量数据库。后端校验回答的引用编号；没有有效依据时不生成确定的政策结论。文字型 PDF 保留页码，扫描图片型 PDF 需要先做 OCR。

`GET /api/ai/status` 返回提供方、模型和配置是否就绪，不返回密钥。模型返回的内容按文本展示，不执行其中的脚本或指令。

## 目录

```text
├─ database/                 业务和 AI 表结构
├─ public/                   页面、样式和交互
├─ src/ai/                   模型适配、检索、工具编排和业务权限
├─ src/services/orders.js    公共订单写入逻辑
├─ src/database-config.js    数据库名称校验
├─ scripts/                  配置、初始化及评测入口
├─ tests/                    业务、AI 和 HTTP 集成检查
├─ .env.example              可提交的配置模板
├─ .gitignore                本地配置与运行产物排除规则
├─ package-lock.json         依赖锁文件
└─ server.js                 Express 服务入口
```

## 测试与评测

```sh
npm test
npm run eval:live
```

`npm test` 强制清空测试子进程的真实模型密钥，使用本机模拟服务与独立测试库，不消耗模型 API 余额。

2026 年 10 月 17 日验证结果：

| 检查类型 | 通过数 |
| --- | --- |
| 核心业务回归 | 19 / 19 |
| AI 集成 | 45 / 45 |
| HTTP 模型适配 | 25 / 25 |
| 完整 HTTP 链路 | 7 / 7 |
| 合计 | 96 / 96 |

检查覆盖角色与数据归属、资料过滤、PDF 提取、引用校验、工具参数、并发确认幂等和事务回滚。回滚测试会故意触发 `synthetic rollback test` 错误，以对应断言和最终退出码判断结果。

`npm run eval:live` 使用真实 DeepSeek API，会消耗余额；只在独立的 `linan_ai_test_api_live` 测试库中使用合成账号和演示资料，不自动确认预约。结果写入 `.runtime/live-evaluation.json` 并导入管理端评测记录。

真实模型最新一批为 7 / 7，覆盖引用问答、无依据拒答、服务与订单查询、补齐预约信息、草稿生成及身份注入拦截。首批出现一次网络连接失败（6 / 7），增加有限网络重试后复测通过，历史记录保留。七个案例是有限样本结果，不代表所有输入下的准确率。桌面与手机页面已检查，无横向溢出或浏览器脚本错误。

## 源码交付

保留 `.env.example`、源码和 `package-lock.json`，不提交真实 `.env`、依赖目录、运行记录或真实业务数据；相关路径已加入 `.gitignore`。接收者配置自己的数据库和 API Key 后运行，模型费用由对应 API 账户承担。

官方接口参考：[工具调用](https://api-docs.deepseek.com/guides/tool_calls)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode)、[接口参数](https://api-docs.deepseek.com/api/create-chat-completion/)。

## 部署边界

当前版本面向本机演示，使用内存 Session 和单进程并发限制，尚未完成长期运行和大规模并发验证。未实现线上支付、OCR、向量检索或集群部署。上线前需配置 HTTPS、持久化 Session、生产日志与数据库备份，并处理演示账号入口。
