# Vercel 部署清单（公开 Demo + 内部驾驶舱）

## 产品定位（与对外话术一致）

- **公开版（Demo）— 产品名：OpenClaw × KOTOVELA**  
  - **开源展示**：给同样使用 **OpenClaw** 的人下载、本地跑、参考实现。  
  - **KOTOVELA 营销**：可对外讲的品牌与产品叙事、截图与链接。  
  - **材料用途**：后续用于 **GPT Pro / 类似计划的试用或权益申请** 时，可作为「公开可访问的 OSS 演示」佐证（以各平台当时规则为准）。  
  - **线上站点不需要 API**：访客只看到仓库内置 **Mock** 叙事，**不依赖**你配置任何 office 接口；也**不必**在 Vercel 为公开项目配 `VITE_OFFICE_INSTANCES_*`。

- **内部驾驶舱（Internal）— 产品名：KOTOVELA HUB**  
  - **你真实在用**：看 **自己** 各实例工作状态、中控总览、项目进度与轮询/上次同步。  
  - **数据**：自建 **Mac mini API（隧道 HTTPS）**、或 Vercel 同域 `/api/office-instances`（多为快照）、失败时 Mock 回退。

---

仓库已配置：

- `vercel.json`：SPA 回写、`/api/*` 不走 `index.html`、PWA manifest 响应头
- `scripts/vercel-build.mjs`：用 **`VERCEL_BUILD_MODE`** 选择 `build:demo` 或 `build:internal`
- 根目录 `api/office-instances.ts`：在 **Vercel 无 OpenClaw CLI** 时用 **`data/office-instances.snapshot.json`** 兜底（主要服务 **Internal** 部署；公开 Demo 前端在 Mock 模式下**不会请求**该接口）

## 1. 建议：两个 Vercel 项目（同一 Git 仓库）

| 项目 | 用途 | `VERCEL_BUILD_MODE` | 访问人群 |
|------|------|---------------------|----------|
| A | 公开开源演示 / 营销 | `demo` 或留空 | 社区、同样用 OpenClaw 的开发者、对外链接、申请材料 |
| B | 内部驾驶舱（实机状态） | `internal` | 你本人 / 小团队；建议 **Vercel Password Protection / SSO** 或仅可信链接 |

两个项目都 **Import 同一 GitHub 仓库**，在各自 **Settings → Environment Variables** 里区分变量即可。

## 2. 必做配置（每个项目）

1. **Framework Preset**：Vite（一般自动识别）
2. **Root Directory**：仓库根（默认）
3. **Build Command**：已由 `vercel.json` 固定为 `node scripts/vercel-build.mjs`（勿改成 `vite build` 单命令，否则选不了模式）
4. **Output Directory**：`dist`（Vite 默认，一般自动）
5. **Install Command**：`npm install`（默认）

## 3. 环境变量

### 公开项目（Demo）

- **`VERCEL_BUILD_MODE`**：不设或设为 `demo`
- 一般 **无需** 再配任何 `VITE_*`：构建会读取仓库里的 `.env.demo`（`VITE_DATA_SOURCE=mock`）
- **刻意不依赖线上 API**：公开站点只做展示与拉新，无需也不应把内部实例接口暴露给访客

### 内部项目（Internal）

- **`VERCEL_BUILD_MODE`** = `internal`（**必填**，否则会变成 Demo 包）
- 默认可依赖仓库内 **`.env.internal`**（已随 Git 提交时）包含轮询、模式等
- **外出要看 Mac mini 实时数据**时，在 Vercel 增加服务端上游变量；前端仍访问同域 `/api/office-instances` 与 `/api/model-usage`：

| 变量 | 说明 |
|------|------|
| `OFFICE_INSTANCES_UPSTREAM_URL` | 填 **完整 HTTPS** 地址，指向 Mac mini 的 `8791` 只读网关，例如 `https://office-api.example.com/api/office-instances` |
| `OFFICE_INSTANCES_UPSTREAM_TOKEN` | 与 `OFFICE_READONLY_GATEWAY_TOKEN` 一致，Vercel 服务端使用，不写入前端静态包 |
| `MODEL_USAGE_UPSTREAM_URL` | 填 **完整 HTTPS** 地址，指向同一 `8791` 只读网关，例如 `https://office-api.example.com/api/model-usage` |
| `MODEL_USAGE_UPSTREAM_TOKEN` | 与 `OFFICE_READONLY_GATEWAY_TOKEN` 一致，Vercel 服务端使用，不写入前端静态包 |
| `KOTOVELA_ACCESS_SECRET` | 内部站访问口令；用于项目内 middleware 保护页面和 API，不写入前端静态包 |
| （可选）`VITE_POLLING_INTERVAL_MS` | 默认内部构建为 5s，可按需改 |

**注意**：Internal 站点会返回真实内部状态和用量线索，务必配合 **访问口令 / Vercel 访问保护 / 私有域访问控制 + 定期轮换 token**，并限制 Internal 站点访问范围。当前 Hobby 计划下，Production 域名可能无法使用完整 Vercel Authentication，因此仓库内提供 `middleware.ts` 作为应用级访问门禁。

#### `kotovelahub` 项目：必须在控制台里配（无法写在仓库里）

同一 Git 仓库对应 **两个** Vercel 项目（公开 Demo + 内部驾驶舱）。**`VERCEL_BUILD_MODE` 不能**写在仓库根 `vercel.json` 的 `env` 里，否则两个项目会共用同一值，**公开站会被打成 Internal 包**。因此 **内部项目必须在 Vercel 控制台单独加变量**（自动化脚本或 CI 若没有你的账号 Token，也无法替你代填）。

**在浏览器里操作（约 1 分钟）：**

1. 打开 [Vercel Dashboard](https://vercel.com/) → 选中项目 **`kotovelahub`** → **Settings** → **Environment Variables**。
2. **Add New**：**Name** `VERCEL_BUILD_MODE`，**Value** `internal`，**Environments** 勾选 **Production**（若 Preview 也要出内部包，再勾选 **Preview**）。
3. **Save** → 进入 **Deployments** → 对 **`main`** 最新一条点 **⋯** → **Redeploy**（或推送空 commit 触发构建）。

你已配置的 **`VITE_DATA_SOURCE=openclaw`** 等可保留；加上 **`VERCEL_BUILD_MODE=internal`** 后，构建会走 `build:internal`，不再触发「公开 Demo 拒绝 openclaw」的守卫。

**可选（本机已安装 Vercel CLI 且已 `vercel link` 到 `kotovelahub`）：** 在仓库根执行 `npx vercel env add VERCEL_BUILD_MODE production`，提示值时输入 `internal`（以 CLI 文档为准）。

## 4. 部署后自测

- **Demo**：任意页数据源为 **Mock**；打开开发者工具 Network，**不应**出现对 office 实例接口的请求（除非有人误改构建变量）
- **Internal**：**中控**是否显示「上次同步」、数据源是否为 OpenClaw / 回退 Mock
- **Internal 访问保护**：未登录打开首页应显示 `Kotovela Hub 访问验证`；未登录 `GET /api/model-usage` 应返回 `401`
- **Internal 可选**：登录后 `GET /api/office-instances` 在同域应返回 JSON；连 Mac mini 时看 `source` 是否为 `live`
- **Internal 可选**：登录后 `GET /api/model-usage` 在同域应返回 JSON；连 Mac mini 时 `source` 应为 `partial` 或 `local-openclaw`，不是 `unavailable`
- 两站均可试 **添加到主屏幕**（见 `docs/deployment.md`「轻应用」）

## 5. 线上地址（定稿）与自定义域名（可选）

**「实际域名」**指你在浏览器里访问用的 **HTTPS 主机名**。**轻应用（添加到主屏幕）**只要求站点是 **HTTPS**；**Vercel 为每个项目提供的 `*.vercel.app` 已完全可用**，不必为了安装 PWA 再单独购买或绑定自有域名。自有域名（如公司主站子域）是 **品牌与分流** 层面的可选项。

以下为团队 **定稿** 的线上域名与页面展示名（与 `AppShell` / PWA manifest / `index.html` 一致）。**Vercel 上项目 slug 需与下表主机名一致**，且 **Production 部署成功** 后对应 `https://…vercel.app` 才可访问；若控制台 **Settings → Domains** 中实际域名与下表不同（例如改过项目名），**以控制台为准**，并同步改 `OFFICE_API_CORS_ORIGIN`、对外文档链接等。

| 站点 | 页面展示名 | 线上域名 | `VERCEL_BUILD_MODE` |
|------|------------|----------|---------------------|
| 公开 Demo | **OpenClaw × KOTOVELA** | `https://openclaw-kotovela.vercel.app` | `demo` 或留空 |
| 内部驾驶舱 | **KOTOVELA HUB** | `https://kotovelahub.vercel.app` | `internal` |

**重要：`*.vercel.app` 来自「项目名 / slug」，不是仓库里写的字符串。** 例如 Overview 里项目名仍是 **`kotovela-workbench-internal`** 时，默认域名一定是 **`https://kotovela-workbench-internal.vercel.app`**。此时去打开 **`https://kotovelahub.vercel.app`** 会得到 **`DEPLOYMENT_NOT_FOUND`**（该子域下没有挂任何项目），**改 `vercel.json` 或前端代码无法修复**。要与上表定稿 **`kotovelahub.vercel.app`** 对齐，在 Vercel 上 **Settings → General → Project Name** 把项目改名为 **`kotovelahub`**（若该 slug 未被占用），保存后在 **Settings → Domains** 确认新默认域，并把 Mac mini 的 **`OFFICE_API_CORS_ORIGIN`** 改成该 HTTPS 源。若暂时不改项目名，则应以 **`kotovela-workbench-internal.vercel.app`** 为内部线上地址，并同步更新文档链接与 CORS。

### 迁到定稿域名：「删旧建新」还是「改名」？

- **改名（通常够用）**  
  不删项目：在 **Settings → General → Project Name** 把 **`kotovela-workbench-internal`** 改成 **`kotovelahub`**。保存后默认 **`https://kotovelahub.vercel.app`** 会指向**当前同一套**部署与配置；旧的 **`kotovela-workbench-internal.vercel.app`** 一般不再作为生产入口（以 Domains 列表为准）。飞书 / 文档里把链接换成新域名即可。

- **删除旧项目再新建（你说的「删掉旧地址、再部署新地址」）**  
  适用：想从零收一个干净项目名、或改名遇到 slug 占用等情况。  
  1. 在旧项目 **Settings → Environment Variables** 里**抄下**全部变量（内部站至少 **`VERCEL_BUILD_MODE=internal`**，以及你配的 **`VITE_OFFICE_INSTANCES_API_PATH`** 等）。  
  2. **Settings → Advanced → Delete Project** 删除旧项目（例如 `kotovela-workbench-internal`）。  
  3. **Add New… → Project**，**Import 同一 Git 仓库**，创建时项目名填 **`kotovelahub`**（公开 Demo 则 **`openclaw-kotovela`**，且 **`VERCEL_BUILD_MODE`** 为 `demo` 或留空）。  
  4. 把抄下的环境变量**原样加回**新项目 → 触发 **Deploy**，确认 **Domains** 里已是定稿域名。  
  5. 更新 **Mac mini** 的 **`OFFICE_API_CORS_ORIGIN`** 为新的内部站 `https://kotovelahub.vercel.app`（或控制台实际域名）。
  6. 在 **Vercel Production Environment Variables** 中显式设置 **`ALLOWED_ORIGIN=https://你的内部站域名`**；仓库代码现已默认回退到“当前请求源站”，但正式环境仍建议显式配置，避免后续换域名时误用默认值。

**说明**：Vercel 上不存在「在仓库里删除旧 URL」这种操作；**线上地址只由项目是否存在、项目名、以及 Domains 配置决定**。删项目或改名后，务必把所有对外链接和 CORS 指到新域名。

若你持有 **kotovela.com** 等自有域，可在两个 Vercel 项目里分别 **Settings → Domains** 添加子域（例如 `www` 指向公开项目、`hub` 或 `ops` 指向内部项目），**CNAME** 到 Vercel 提示的目标即可；**必须 HTTPS**（Vercel 自动证书）。关键是 **公开与内部两个源站分离**，避免把内部实例数据面与公开展示混在同一入口认知里。

## 6. 常见问题

**Q：浏览器打开 `https://xxx.vercel.app` 整站 404？**  
先在终端执行：`curl -sI "https://你的域名/" | grep -i x-vercel-error`  
- 若出现 **`DEPLOYMENT_NOT_FOUND`**：这是 **Vercel 在该主机名下没有任何已发布的 Production 部署**，与仓库里的 `vercel.json` 重写规则**无关**；改代码也解决不了，必须先让控制台里 **Deployments → Production = Ready**。请逐项确认：① 已在 Vercel **Import** 本仓库并关联正确的 Git 分支；② 最新 **Production** 构建成功（失败则整站不可用）；③ 浏览器地址栏里的域名与 **Settings → Domains** 里显示的默认域一致（项目改名后 `*.vercel.app` 会变）。定稿表中的 `openclaw-kotovela`、`kotovelahub` 需与 **Vercel 项目名（slug）**一致；不一致时用控制台域名。  
- 若 **没有** `DEPLOYMENT_NOT_FOUND`、而是访问子路径（如 `/projects`）404：再检查 `vercel.json` 的 SPA `rewrites` 与 **Output Directory**（本仓库已在 `vercel.json` 写明 **`outputDirectory`: `dist`**）。

**Q：Internal 页面一直是 Mock？**  
检查 `VERCEL_BUILD_MODE=internal` 是否在该环境的 **Production**（及 Preview 如需）都已设置；重新 Deploy。

**Q：内部项目 Production 报错 `Refusing public demo build: VITE_DATA_SOURCE=openclaw is set`？**  
说明 **`VERCEL_BUILD_MODE` 未设为 `internal`**，Vercel 走了 **公开 Demo** 构建路径，而 Demo 守卫禁止 `VITE_DATA_SOURCE=openclaw`。**不要**为通过构建而删掉 `VITE_DATA_SOURCE`（内部站需要 OpenClaw 时应保留）。正确做法：在 **`kotovelahub` 的 Production（及需要的 Preview）** 增加 **`VERCEL_BUILD_MODE=internal`**，保存后 **Redeploy**。

**Q：想连家里 Mac mini API？**  
Mac mini 上运行 `./scripts/install-office-bridge-runtime-launchd.sh`，让 Cloudflare Tunnel 只连接 `127.0.0.1:8791` 的白名单网关。把完整 HTTPS URL 分别写入 `OFFICE_INSTANCES_UPSTREAM_URL` / `MODEL_USAGE_UPSTREAM_URL`，并把 `OFFICE_READONLY_GATEWAY_TOKEN` 写入对应 `*_TOKEN` 后 **重新部署**。

**Q：快照太旧？**  
在本机或 CI 执行 `npm run sync:office-snapshot`，提交 `data/office-instances.snapshot.json` 后再推送到触发 Vercel 构建。

---

## 公开版定稿（可选：长期不随主分支迭代）

**可以**把公开版当作「营销 / 开源展示」的**稳定面**，后续**少更新或不更新**；内部驾驶舱继续在 `main` 上迭代即可。

| 做法 | 说明 |
|------|------|
| **Git 打标签** | 例如 `git tag demo/v1.0` 标记当前对外叙事满意的提交。 |
| **Vercel 公开项目绑分支** | Production Branch 设为 `main` 或单独维护的 `release/demo`；若希望**完全冻结**，可把公开项目的 Production 指向**只含修复的维护分支**或**固定 tag**（按 Vercel 支持的 Git 引用方式配置）。 |
| **内部项目** | 仍跟踪 `main`（或你的工作分支），`VERCEL_BUILD_MODE=internal`。 |

**数据安全（已实现）**

- 公开构建为 **`build:demo`**，仓库内 **`.env.demo` 固定 `VITE_DATA_SOURCE=mock`**，运行时**不会**请求你的实例接口。  
- **`scripts/verify-demo-build-safe.mjs`** + **`vercel-build.mjs`**：若在公开构建环境中误设 **`VITE_DATA_SOURCE=openclaw`** 或 **`VITE_MODE=internal`**，**构建会直接失败**，避免把真实数据模式打进对外站点。

**营销与开源**

- 当前公开版（**OpenClaw × KOTOVELA**）= **通用 Mock 叙事** + 可克隆本地运行，**不含你的实机状态**，适合对外链接、README、申请材料。  
- 「定稿」更多是**流程选择**：公开站点少动；**安全底线**由上述校验与 Mock 模式保证，而不是必须永远不改代码。
