# 安装与运行

本指南适用于从 GitHub 下载或克隆源码后的本机运行。需要自行配置 MySQL 和 DeepSeek API Key，仓库不附带真实密钥或数据库。

## 环境要求

| 组件 | 要求 |
| --- | --- |
| Node.js | 22.13 或以上版本，包含 npm |
| MySQL | 8，服务已启动；数据库账号有创建项目库、表和索引的权限 |
| 模型接口 | 可调用的 DeepSeek API Key；智能助手调用消耗对应账号余额 |
| 浏览器 | 支持现代 JavaScript 的桌面浏览器 |

PDF.js 已包含在项目依赖中，通过 `npm ci` 安装；不需要额外安装 Embedding 服务或向量数据库。缺少模型密钥时，普通业务仍可运行，智能助手会显示配置提示。

## 首次安装

下载仓库 ZIP 并解压，或执行：

```sh
git clone https://github.com/LSYM29/linan-elderly-care-ai.git
cd linan-elderly-care-ai
```

在包含 `package.json` 的项目目录执行：

```sh
npm ci
node scripts/setup-env.js
npm run init-db
npm run init-ai
npm run config:api
npm start
```

配置向导会询问本机 MySQL 密码，生成本目录的 `.env` 和随机 Session 密钥。远程数据库、自定义账号或端口需要在初始化前修改 `.env` 中对应配置。先初始化业务表，再初始化 AI 表和演示资料；初始化会复用已有的 `ai_faqs`。

`npm run config:api` 的密钥输入不会显示，按回车保存；Windows 用户也可双击根目录的 `配置API密钥.bat`，在输入框中粘贴并保存。真实密钥只写入本地 `.env`，不要发送到聊天、写入前端或提交到仓库。

启动后打开 <http://127.0.0.1:3002>。服务默认只监听本机 `127.0.0.1`；这不是供其他人访问的在线演示地址。

### Windows 启动入口

安装 Node.js 和 MySQL 后，可以双击根目录 `启动系统.bat`。它会检查环境、引导配置、安装缺少的依赖、执行数据库初始化并启动服务。已有环境也可按上面的命令使用 `npm ci` 进行确定版本的安装。

运行时保留启动窗口；在该窗口按 `Ctrl+C` 可停止服务。修改 `.env` 或保存新密钥后，需要停止并重新启动。

### macOS 和 Linux

使用前述终端命令，不运行 `.bat` 或 `.ps1` 文件。自行启动本机 MySQL 服务，再执行初始化和启动命令。

## 配置项

配置模板见 [`.env.example`](../.env.example)。配置文件位于项目根目录。

| 配置项 | 默认值或用途 |
| --- | --- |
| `PORT` | `3002`，修改后使用对应端口访问 |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` |
| `DB_USER` / `DB_PASSWORD` | 本机 MySQL 账号与密码 |
| `DB_NAME` | `linan_ai_api`，运行数据库 |
| `SESSION_SECRET` | 配置向导生成的随机密钥 |
| `AI_ENABLED` | `1`，挂载 AI 功能 |
| `AI_PROVIDER` | `deepseek` |
| `AI_BASE_URL` | `https://api.deepseek.com/v1` |
| `AI_MODEL` | `deepseek-flash` |
| `DEEPSEEK_API_KEY` | 在本地配置，不提供预置密钥 |
| `AI_TIMEOUT_MS` | `45000`，单次模型调用总时限 |
| `AI_MAX_TOKENS` | `2048` |
| `AI_RETRIES` | `1`，可设为 `0` 关闭重试 |

数据库名限定为 `linan_ai_api`、`linan_ai_test_api`，或在其后追加下划线及一组英文字母、数字，例如 `linan_ai_test_api_live`。连接池和初始化入口均校验名称，不访问其他命名空间的数据库。数据库会话和预约时间使用北京时间。

## 演示账号

初始化脚本提供合成演示数据：

| 角色 | 用户名 | 密码 |
| --- | --- | --- |
| 家属 | `family` | `family123` |
| 管理员 | `admin` | `admin123` |
| 护理人员 | `caregiver` | `caregiver123` |

家属登录后进入“AI 服务助手”，可以询问预约取消规则、查询服务与自己的订单。预约时提供具体服务、未来的日期时刻及详细地址，核对生成的卡片后再决定是否点击确认。只说“明天下午”等信息不完整的需求，会要求继续补充；聊天中的“确认”不会直接创建订单。

管理员可以导入知识资料、管理资料状态、查看运行记录与评测汇总。演示库未收录正式地方补贴政策，不能用演示资料代替当地官方政策。

## 测试与评测

```sh
npm run check
npm test
```

`npm run check` 检查 JavaScript 语法。`npm test` 初始化独立的 `linan_ai_test_api` 测试库，清空测试子进程的真实模型密钥，使用本机模拟模型服务，不消耗模型 API 余额。也可通过环境变量 `TEST_DB_NAME` 指定符合命名规则的独立测试库。

当前 `npm test` 在回归结束后，还会把测试评测记录导入 `.env` 中 `DB_NAME` 指定的运行库，供管理端展示；因此应先完成运行库初始化。独立测试库用于业务测试，评测导入会写入运行库的评测表。不要把这一步理解成完全没有运行库写入。

回滚测试会故意触发 `synthetic rollback test` 错误，以对应断言和最终退出码判断是否通过。历史检查结果及日期见 [README](../README.md#测试与评测)。

真实模型评测单独执行：

```sh
npm run eval:live
```

该命令调用真实 DeepSeek API，会消耗余额；使用独立的 `linan_ai_test_api_live` 库、合成账号和演示资料，不自动确认预约。结果保存在 `.runtime/live-evaluation.json`，并导入管理端评测记录。七个案例是有限样本结果，不代表所有输入下的准确率。

## 常见问题与错误提示

模型接口的上游 401、403、402、429 等会被后端转换为用户可读提示，通常向页面返回 HTTP 503。以下 `MODEL_*` 是模型适配层的内部错误标识，可在运行记录的失败原因中核对，不是前端响应必须包含的 `code` 字段。

| 情况或内部标识 | 检查方式 |
| --- | --- |
| MySQL 拒绝连接或 `ECONNREFUSED` | 检查 MySQL 服务、`DB_HOST` 和 `DB_PORT` |
| MySQL `Access denied` | 检查 `DB_USER`、`DB_PASSWORD` 及账号权限 |
| `EADDRINUSE` | 本机已有进程使用该端口；关闭重复启动的本项目，或修改 `PORT` 后重启 |
| `MODEL_NOT_CONFIGURED` | 本地填写密钥后重启；状态页“已配置”只代表配置格式就绪，不代表真实调用一定成功 |
| `MODEL_AUTH`（上游 401 / 403） | 密钥无效或已停用，检查本地配置 |
| `MODEL_BALANCE`（上游 402） | 在模型开放平台检查账号余额 |
| `MODEL_RATE_LIMIT`（上游 429） | 等待后重试，检查请求频率 |
| `MODEL_BUSY` | 本进程正在处理其他模型请求，稍后重试 |
| `MODEL_TIMEOUT` / `MODEL_NETWORK` | 检查网络与接口可达性；模型超时不会自动提交预约 |
| `MODEL_CONFIG`（含上游 400 / 404） | 检查 API 地址、模型名称和配置格式 |
| `MODEL_INVALID_JSON` / `MODEL_TRUNCATED` | 缩小问题范围后重试 |
| `MODEL_UNEXPECTED_TOOL` | 不支持的工具操作已被阻止，可拆小问题后重试 |

临时网络、限流和服务异常最多重试一次，且仍受调用总时限约束。预约草稿过期、修订号不一致或价格变化时，按页面提示修改或重新生成，重新核对后确认。

## 交付与部署边界

源码交付保留 `.env.example`、`package-lock.json`、代码、测试和文档；不提交 `.env`、`node_modules`、`.runtime` 或真实业务数据。相关路径已加入 `.gitignore`，接收者配置自己的数据库和 API Key 后运行，模型费用由对应账号承担。

当前面向本机演示，使用内存 Session 和单进程并发限制，尚未完成长期运行和大规模并发验证。未实现线上支付、OCR、向量检索或集群部署。上线前需要配置 HTTPS、持久化 Session、生产日志和数据库备份，并处理演示账号入口。仅上传 GitHub 不会自动部署网站。

模型协议参考：[工具调用](https://api-docs.deepseek.com/guides/tool_calls)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode)、[接口参数](https://api-docs.deepseek.com/api/create-chat-completion/)。
