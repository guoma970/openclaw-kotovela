# Deployment Notes

## 本地运行（开发）

```bash
cd /path/to/repo
npm install
# 公开演示（Mock）：npm run dev:demo
# 内部驾驶舱（默认轮询 OpenClaw）：npm run dev:internal
npm run dev:internal
```

浏览器访问 **http://localhost:5173**（端口写死，勿被占用）。

### 内部驾驶舱：本机显示「真实 OpenClaw」状态（操作清单）

目标：页面数据来自本机执行的 `openclaw sessions`，而不是 `src/data/mockData.ts`。

1. **前提**
   - 本机已安装 CLI：`openclaw --version` 有版本号。
   - 仓库根目录已 `npm install`。

2. **用 Internal 模式启动（会加载 `.env.internal`）**

   ```bash
   npm run dev:internal
   ```

   默认配置（见仓库内 `.env.internal`）为：`VITE_MODE=internal`、`VITE_DATA_SOURCE=openclaw`、`VITE_OFFICE_INSTANCES_API_PATH=/api/office-instances`。  
   Vite 开发服务器会把 **`/api/office-instances`** 代理到同仓库的 `server/officeInstances.ts`：在 **Node 子进程里**执行与线上一致的 `openclaw --log-level silent sessions --json --all-agents --active 240`，把 JSON 转成驾驶舱用的 payload。

3. **自检接口是否「live」**（需在 `dev:internal` 已启动时执行）

   ```bash
   npm run check:office
   ```

   或手动：

   ```bash
   curl -s http://127.0.0.1:5173/api/office-instances | head -c 400
   ```

   - 若 JSON 里 **`"source":"live"`**：表示已读到 `openclaw sessions`，不是快照文件。
   - 若 **`"source":"snapshot"`**：表示本机 `openclaw` 未返回可用会话，已回退到 `data/office-instances.snapshot.json`（可 `npm run sync:office-snapshot` 更新快照）。
   - 若请求失败（5xx / 连接拒绝）：前端在配置了 `VITE_FALLBACK_TO_MOCK=true` 时会 **回退 Mock**，顶栏可能仍显示「Mock」或提示 fallback。

4. **若仍像 Mock 或数据不对**
   - 直接跑：`openclaw --log-level silent sessions --json --all-agents --active 240`，确认 stdout 是合法 JSON 且 `sessions` 非空。
   - 临时将 `.env.internal` 中 **`VITE_FALLBACK_TO_MOCK=false`**（或在本机 `.env.internal.local` 覆盖）再试一次，便于在浏览器 Network 里看到 **真实接口错误**，而不是静默 Mock。
   - 确认没有用 **`npm run dev:demo`**（Demo 固定 `VITE_DATA_SOURCE=mock`，不会请求真实实例）。

5. **外出访问（手机 / Vercel 读家里 Mac）**
   云端 **没有** 你的 `openclaw` 二进制和本机 Claude Code 状态，需二选一：
   - 在 **Mac mini** 上安装 detached office-bridge runtime；公网隧道只指向 `127.0.0.1:8791` 的白名单网关，完整 office API 仅监听 `127.0.0.1:8787`。Vercel 内部项目里配置 **服务端上游变量**（`OFFICE_INSTANCES_UPSTREAM_URL` / `MODEL_USAGE_UPSTREAM_URL` 及对应 token）。见下文「Mac mini 常驻」与 **`docs/vercel-setup.md`**。
   - 如果你外出时希望继续只靠飞书研发群推进开发，请在私有运行环境中配置项目研发群；公开仓库只保留占位符（如 `<FEISHU_CHAT_ID_KOTOVELA_HUB>`）。具体接力口径见 **`docs/ops/feishu-dev-handoff.md`**。

## 生产构建校验

```bash
npm run lint
npm run build
```

## 预发布建议（推荐）

当前最适合先走 **Vercel 预发布**。完整步骤（双项目 Demo / Internal、`VERCEL_BUILD_MODE`、环境变量）见 **[vercel-setup.md](./vercel-setup.md)**。

简版：

1. 将仓库导入 Vercel
2. Build Command 由仓库根 `vercel.json` 指定为 `node scripts/vercel-build.mjs`（勿在控制台改成裸 `vite build`）
3. Output Directory 使用默认 `dist`
4. `api/office-instances.ts` 与 `api/model-usage.ts` 作为服务端接口保留同域 API
5. 前端通过同域 `/api/office-instances` 获取实例状态

这样可以得到一个：
- 手机可打开
- 飞书内可直接访问
- 不依赖本地 `localhost`
- 仍保留实例状态与模型用量接口的预发布版本

## Mac mini 常驻：detached office bridge（外出访问）

若有一台 **24h 开机的 Mac mini**，已安装并运行 OpenClaw，先在仓库里准备依赖，再安装到 Git 工作树外的版本化运行目录：

```bash
npm install
OFFICE_API_PORT=8787 \
OFFICE_API_TOKEN='随机长密钥' \
OFFICE_API_CORS_ORIGIN='https://kotovelahub.vercel.app' \
OFFICE_READONLY_GATEWAY_TOKEN='另一条随机长密钥' \
OFFICE_READONLY_GATEWAY_UPSTREAM_TOKEN='随机长密钥' \
./scripts/install-office-bridge-runtime-launchd.sh
```

在另一个终端执行自检；`OFFICE_CHECK_TOKEN` 必须与服务启动时的 `OFFICE_API_TOKEN` 完全一致：

```bash
OFFICE_CHECK_TOKEN='随机长密钥' npm run check:office-api
```

- `check:office-api` 会直接请求 `http://localhost:8787/api/office-instances`，输出 `source / generatedAt / snapshotGeneratedAt / instances / statuses`，适合作为常驻服务启动后的第一步自检
- 用量统计可额外自检：`curl -H "Authorization: Bearer <token>" http://localhost:8787/api/model-usage`，若返回 `source: "partial"` 或 `source: "local-openclaw"`，表示已读到本机 OpenClaw / Claude Code 线索
- `OFFICE_API_CORS_ORIGIN` 须与内部站在浏览器中的 **HTTPS 源**一致（上例为 **KOTOVELA HUB** 常用部署域 `https://kotovelahub.vercel.app`；若你使用自有域名，请改成实际主机名）
- 接口：`GET http://<mini 局域网或隧道>:8787/api/office-instances` 与 `GET http://<mini 局域网或隧道>:8787/api/model-usage`
- 鉴权（推荐）：设置 `OFFICE_API_TOKEN` 后，请求需带 `Authorization: Bearer <token>` 或 `?token=<token>`；线上 Vercel 应使用服务端变量保存 token，避免写入前端静态包
- 内部访问口令：Vercel 项目需设置 `KOTOVELA_ACCESS_SECRET`，仓库根 `middleware.ts` 会同时保护页面与 `/api/*`，未登录 API 应返回 `401`
- **外出访问**：家庭宽带通常无固定公网 IP，需任选其一：
  - **Cloudflare Tunnel** / **Tailscale Funnel** / **ngrok**：把只读网关 `8791` 暴露为 **HTTPS**（不得直接暴露完整 API 的 `8787`）
  - 或 **仅 Tailscale/ZeroTier VPN**：手机加入同一虚拟网后访问 `http://100.x.x.x:8787`
- **Vercel internal 前端**：前端继续走同域 `/api/office-instances` / `/api/model-usage`；在 Vercel 服务端环境变量里把上游地址设为隧道给出的 **HTTPS** 地址（分别带 `/api/office-instances` 与 `/api/model-usage` 路径）
- **launchd**：仓库提供本机用户级 LaunchAgent 脚本，把 office-api、只读网关和 Cloudflare connector 打包到 Git 工作树外的版本化运行目录，并在异常退出后由 `KeepAlive` 拉起。

### office API 开机自启（macOS launchd）

安装前建议先在当前 shell 里放好生产参数；`OFFICE_API_PORT` 默认 `8787`，`OFFICE_API_TOKEN` 默认必填：

```bash
cd /path/to/repo
npm install

OFFICE_API_PORT=8787 \
OFFICE_API_TOKEN='随机长密钥' \
OFFICE_API_CORS_ORIGIN='https://kotovelahub.vercel.app' \
./scripts/install-office-bridge-runtime-launchd.sh
```

脚本会先打包并校验 release，再生成临时 plist 并执行 `plutil -lint`，通过后才替换并加载：

```text
~/Library/LaunchAgents/com.kotovela.office-api.plist
```

服务从固定运行入口执行，不读取开发工作树：

```text
~/Library/Application Support/Kotovela/office-bridge-runtime/current
```

可变状态位于同级 `state`，凭据位于 `~/.config/kotovela`（`600`），日志位于 `~/Library/Logs/Kotovela/office-bridge`。运行 release 可按 id 独立回退：

```bash
./scripts/rollback-office-bridge-runtime-launchd.sh --list
./scripts/rollback-office-bridge-runtime-launchd.sh <release-id>
```

自检：

```bash
OFFICE_CHECK_TOKEN='随机长密钥' npm run check:office-api
launchctl print gui/$(id -u)/com.kotovela.office-api | head -n 80
```

其中 `OFFICE_CHECK_TOKEN` 必须等于安装时写入 launchd 的 `OFFICE_API_TOKEN`。

查看日志：

```bash
tail -f ~/Library/Logs/Kotovela/office-bridge/office-api.log
tail -f ~/Library/Logs/Kotovela/office-bridge/office-api.error.log
```

卸载/停用：

```bash
./scripts/uninstall-office-api-launchd.sh
```

注意：如果安装后修改 `OFFICE_API_TOKEN` / `OFFICE_API_CORS_ORIGIN` / `OFFICE_API_PORT`，需要带新环境变量重新执行安装脚本；launchd 不会自动继承交互 shell 的后续环境变量。公网链路不允许无 token 启动。

## 实例状态同步（远程查看）

本地开发环境可以直接通过 `openclaw sessions` 读到实时状态。  
远程预发布环境（例如 Vercel）读不到你本机的 OpenClaw 运行态，所以需要一份最近同步的快照作为 fallback。

### 手动同步一次状态快照

```bash
npm run sync:office-snapshot
```

这会更新：

```text
data/office-instances.snapshot.json
```

建议节奏：
- 每次准备发布/推送前，先跑一次 `npm run sync:office-snapshot`
- 然后再 `git add` / `commit` / `push`
- Vercel 发布后，远程页会优先读本机实时数据；拿不到时自动退回到这份最近同步的快照

### 每 10 分钟自动同步一次（推荐）

仓库已提供：

```text
.github/workflows/sync-office-snapshot.yml
```

这个 workflow 会：

- 每 10 分钟执行一次
- 在 runner 上运行 `npm run sync:office-snapshot`
- 仅当 `data/office-instances.snapshot.json` 发生变化时自动提交并推送
- 借助现有 GitHub + Vercel 链路把远程页更新出去

前提：

- 必须使用 `self-hosted runner`
- runner 所在机器要能直接执行 `openclaw sessions`
- runner 需要挂在这个仓库上，并且常驻在线

如果没有 self-hosted runner，当前仍以“手动同步 snapshot”作为远程更新方式。

### 本机定时同步（macOS launchd）

如果你更希望直接在本机自动跑，而不是先接 GitHub runner，仓库还提供了 `launchd` 方案，见：

```text
docs/ops/office-snapshot-sync.md
```

这套方案适合：

- 你本机就是 OpenClaw 运行机
- 你希望每 10 分钟自动生成并推送 snapshot
- 你愿意用一个“专门用于同步的干净 clone”来执行自动任务

### 当前策略

- 本机打开：优先实时
- 远程预发布打开：优先实时接口，失败时退回快照
- 下一步如果要做到真正“持续实时”，再补本机到云端的自动状态同步

## 飞书内「轻应用」入口（工作台 / 自建应用）

站点本身是 **HTTPS 单页应用**，已适配移动端 `viewport` 与 PWA meta。要在 **飞书里像轻应用一样一键打开**（同事从工作台进，不必记域名），需要在 **飞书管理侧** 配入口，而不是只改仓库代码。

### 和「手机桌面 PWA」的区别

| 方式 | 说明 |
|------|------|
| **飞书工作台 / 网页应用** | 在飞书 **内置浏览器 / WebView** 里打开你的 `https://…vercel.app`，体验类似「钉在工作台上的 H5 轻应用」；**不能**指望飞书内出现与 Safari 完全相同的「添加到主屏幕」流程。 |
| **系统浏览器 PWA** | 用户在 **Safari / Chrome** 里打开同一 HTTPS 地址，再 **添加到主屏幕 / 安装应用**，得到桌面独立图标（见下文「手机轻应用」）。 |

两者可同时使用：日常在飞书里点工作台；需要全屏独立窗口时用系统浏览器安装。

### 推荐配置方式（择一或组合）

1. **工作台添加快捷网页（最常见）**  
   企业管理员：**管理后台** → **工作台**（或 **企业文化 / 应用管理**，以你租户后台文案为准）→ **添加** → 选择 **网页** / **自定义链接** → 填写 **内部驾驶舱** 的 `https://kotovelahub.vercel.app`（或你的定稿域名）、名称如 **KOTOVELA HUB** → 保存并设可见范围。

2. **飞书开放平台 · 企业自建应用（更正式）**  
   在 [飞书开放平台](https://open.feishu.cn/) 创建 **企业自建应用** → 配置 **网页应用** / **应用主页** 为你的 HTTPS 地址 → 发布版本 → 在管理后台把该应用 **上架到工作台** 并授权给成员。适合需要以后接 **飞书登录、JSSDK、审批** 等能力时再演进。

3. **群 / 文档入口**  
   在飞书群 **置顶**、**群公告** 或 **知识库** 里固定 HTTPS 链接，作为补充入口。

### 技术侧注意（当前仓库已满足大部分）

- 地址必须是 **HTTPS**（Vercel 默认满足）。  
- 本应用为前端 SPA，**不依赖**必须在飞书 WebView 里弹第三方登录 cookie 才可用的跨站策略；若日后接飞书 OAuth，再单独评估 WebView 内回调 URL。  
- 若飞书内打开出现 **空白或脚本被拦**，到管理后台检查是否误开 **仅内网** 或 **未知域名拦截**，把 `*.vercel.app` 或你的自有域加入可信列表。

更完整的双站部署与域名定稿见 **[vercel-setup.md](./vercel-setup.md)**。

## 手机 / iPad / 电脑「轻应用」体验

仓库已提供 **双份 Web App Manifest**（`public/manifest.demo.webmanifest` / `manifest.internal.webmanifest`，由 Vite `mode` 注入到 `index.html`）与 **Apple 全屏 meta**。部署到 **HTTPS** 即可（**Vercel 默认的 `*.vercel.app` 已满足**；自有域名仅为品牌与分流，**不是**「添加到主屏幕」的前置条件）：

- **iPhone / iPad（Safari）**：分享 → **添加到主屏幕**，可从桌面图标以 **独立窗口** 打开（类似轻应用）
- **Android（Chrome）**：菜单 → **安装应用** 或 **添加到主屏幕**
- **桌面 Chrome / Edge**：地址栏安装提示（若浏览器支持）

图标当前使用 `favicon.svg`；若需 iOS 旧系统更稳的触控图标，可后续增加 `apple-touch-icon` 专用 PNG（180×180）。

## 当前边界

- 这版更适合 **预发布 / 演示 / 验收**
- 不建议直接定义为正式生产上线
- 上线前仍建议补一次移动端验收与远程真实使用验收

## GitHub CI

- CI 配置文件：`.github/workflows/ci.yml`
- 触发：`push` / `pull_request`
- 定时 snapshot 同步：`.github/workflows/sync-office-snapshot.yml`

## 分支约定

- `main`：基线分支
- `feat/*`：功能开发分支

## 发布建议（V1 Demo）

1. 在 `feat/*` 完成阶段性收口（含页面截图）
2. 发起 PR 到 `main`
3. PR 通过后并入 `main` 作为里程碑提交
