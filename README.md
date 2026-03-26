# Memo App - 桌面备忘录应用

基于 Tauri + React + TypeScript + SQLite 的桌面备忘录应用。

## 功能特性

- 笔记 CRUD（创建、编辑、删除）
- 自动保存（防抖 1 秒，内容变化检测）
- 全文搜索（LIKE 子串匹配，支持中文）
- 分类管理（按分类筛选笔记）
- 图片粘贴（可视化渲染，支持拖拽调整大小，宽度持久化）
- 语音输入（仅 macOS，基于原生 SFSpeechRecognizer，支持中文）

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite |
| 后端 | Rust (Tauri 2) |
| 数据库 | SQLite (rusqlite + FTS5) |
| 语音识别 | Swift (SFSpeechRecognizer) |

## 项目结构

```
memo-app/
├── src/                          # 前端代码
│   ├── App.tsx                   # 主应用组件
│   ├── App.css                   # 全局样式
│   ├── components/
│   │   ├── NoteEditor.tsx        # 笔记编辑器（图片渲染、语音输入）
│   │   ├── NoteItem.tsx          # 笔记列表项
│   │   ├── SearchBar.tsx         # 搜索栏（300ms 防抖）
│   │   ├── CategoryManager.tsx   # 分类管理
│   │   └── Toast.tsx             # 提示消息
│   ├── store/
│   │   └── useStore.ts           # Zustand 状态管理
│   ├── types/
│   │   └── index.ts              # TypeScript 类型定义
│   └── utils/
│       └── api.ts                # Tauri invoke 封装
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs                # 应用入口、状态管理
│   │   ├── commands.rs           # Tauri 命令（CRUD、搜索、图片）
│   │   ├── speech.rs             # 语音识别进程管理
│   │   ├── models.rs             # 数据模型
│   │   └── db/
│   │       └── mod.rs            # SQLite 初始化、FTS5、触发器
│   ├── speech_helper.swift       # macOS 原生语音识别助手
│   ├── speech_helper             # 编译后的语音识别二进制
│   ├── Info.plist                # macOS 权限声明
│   ├── tauri.conf.json           # Tauri 配置
│   └── Cargo.toml                # Rust 依赖
└── package.json
```

## 语音识别技术方案

### 方案选型

| 方案 | 技术 | 结果 |
|------|------|------|
| A - macOS 原生 | SFSpeechRecognizer (Swift) | **采用** - 系统级、中文好、无额外依赖 |
| B - Whisper 本地模型 | whisper-rs (Rust) | 备选 - 离线、跨平台，但模型大(~1GB) |
| C - Web Speech API | 浏览器原生 | **失败** - Tauri WKWebView 不支持 |
| D - 第三方云服务 | 讯飞/百度 API | 未尝试 - 需要 API Key、收费 |

### 架构

```
┌──────────────┐    Tauri Events     ┌──────────────┐    stdin/stdout    ┌─��─────��──────────┐
│   React 前端  │ ◄────────────────► │   Rust 后端   │ ◄──────────────► │  Swift 语音助手    │
│  NoteEditor  │  speech-partial     │  speech.rs   │   PARTIAL:文本    │  speech_helper    │
│              │  speech-final       │              │   FINAL:文本      │  SFSpeechRecognizer│
│              │  speech-stopped     │              │   DONE / STOP     │  AVAudioEngine    │
└──────────────┘                     └──────────────┘                    └──────────────────┘
```

**三层通信**：

1. **Swift ↔ Rust**：子进程 stdin/stdout 管道，文本协议
   - Swift 输出：`PARTIAL:文本`、`FINAL:文本`、`DONE`
   - Rust 输入：`STOP`（停止识别）
2. **Rust ↔ 前端**：Tauri Events 异步推送
   - `speech-partial`：实时识别预览
   - `speech-final`：最终确认文本
   - `speech-stopped`：识别结束
3. **前端状态管理**：`lastFinalTextRef` 跟踪累积文本，计算增量追加到笔记

### 开发过程中踩过的坑

#### 1. Swift 编译器版本不匹配

SDK 是 Swift 6.2，编译器是 6.1.2，直接编译报错。

**解决**：指定兼容的旧版 SDK：

```bash
swiftc -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk \
  -o speech_helper speech_helper.swift \
  -framework Speech -framework AVFoundation
```

#### 2. Web Speech API 在 Tauri WKWebView 中不可用

Tauri 使用 macOS 的 WKWebView，不支持 `webkitSpeechRecognition`，调用后报 `service-not-allowed`。这直接排除了最简单的方案 C。

#### 3. 主线程 RunLoop 阻塞（最难排查）

**现象**：权限全部通过、音频正常采集、但识别回调永远不触发。

**原因**：最初使用 `DispatchSemaphore.wait()` 阻塞主线程等待退出信号。Apple 的 Speech 框架内部依赖主线程 RunLoop 来分发回调，主线程被阻塞后回调无法触发。

**解决**：改用 `dispatchMain()` 保持主线程 RunLoop 活跃，退出时用 `exit(0)`。

#### 4. 麦克风权限和语音识别权限是两个独立权限

仅调用 `SFSpeechRecognizer.requestAuthorization()` 不够，还需要 `AVCaptureDevice.requestAccess(for: .audio)` 请求麦克风权限。二者缺一不可。

#### 5. 停止时最后一段文本丢失

**原因**：`recognitionTask?.cancel()` 直接取消任务，不会发送最终识别结果。

**解决**：`stop()` 中先将 `lastResult`（实例变量）作为 `FINAL` 输出，然后再调用 `cancel()`。

#### 6. 设备端 vs 在线识别

- `requiresOnDeviceRecognition = true`：无网络延迟，但需要下载离线模型
- 不设置：使用 Apple 在线服务，延迟约 1-2 秒
- 当前策略：优先设备端，如模型未安装则需要用户在系统设置中下载

### 后续优化方向

**体验优化**：

- PARTIAL 实时预览直接显示在光标位置（目前在单独的预览条中）
- 添加音量指示器，让用户知道麦克风在采集
- 长时间无语音自动停止
- 支持连续录入多段，不必每次停止才写入

**识别质量**：

- 检测并引导用户下载设备端中文模型（系统设置 → 键盘 → 听写），提升速度和准确度
- 先尝试设备端，超时自动回退在线模式
- 考虑 Whisper 方案作为跨平台备选（whisper-rs + ggml 量化模型）

**工程化**：

- 将 speech_helper 打包进 .app bundle（目前依赖编译时路径）
- 配置 Tauri 的 `externalBin` sidecar 用于生产构建
- 编译脚本自动化（检测架构、选择 SDK、编译 Swift）

## 搜索实现

初期使用 SQLite FTS5 全文搜索，但 FTS5 默认 `simple` 分词器不支持中文（按空格分词，中文连续字符被当作一个整体 token）。

**最终方案**：改用 `LIKE '%query%'` 子串匹配，完美支持中文搜索。对于个人备忘录场景（百级笔记量），LIKE 性能完全足够。

SearchBar 添加了 300ms 防抖，避免每次按键触发数据库查询。

## 图片功能

- 粘贴图片自动保存到 `app_data_dir/images/`，内容中插入 `![image](images/xxx.png)`
- 编辑器解析 markdown 图片语法，渲染为可视化图片（非原始文本）
- 支持右下角拖拽调整大小，宽度编码在 alt 文本中：`![image|300](path)`
- 点击图片全屏预览

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run tauri dev

# 启动远程会议信令服务（跨设备开会）
npm run meeting:signal

# 编译语音助手（如需重新编译）
swiftc -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX15.2.sdk \
  -o src-tauri/speech_helper src-tauri/speech_helper.swift \
  -framework Speech -framework AVFoundation

# 构建
npm run tauri build

# 仅构建 macOS 正式安装包（不签名）
npm run tauri build -- --bundles app,dmg --no-sign --ci
```

## 远程开会（跨设备）

当前会议模块已支持“本地信令 / 远程信令”双模式：

- 未配置远程地址：走本地 Tauri SQLite（仅本机调试）。
- 配置远程地址：走 HTTP 信令服务（可跨设备）。

### 1) 启动信令服务

在一台可被其他设备访问的机器上运行：

```bash
npm run meeting:signal
```

可选环境变量：

```bash
MEETING_SIGNAL_HOST=0.0.0.0
MEETING_SIGNAL_PORT=8787
```

### 2) 会议页配置

在会议页面右侧“远程信令”区域填写：

- 服务地址：例如 `http://你的IP:8787`
- 房间标识：建议使用“共享房间码”（默认已自动填充）

点击“保存配置”后即切到远程模式。两端填写同一服务地址 + 同一房间标识即可互通。

## 网页版入会与下载页

当前 Web 端已支持公开页面入会（无需安装桌面端）：

- `/`：落地页（网页版入会 + 下载 App）
- `/join`：网页版入会页（昵称 + 房间标识）
- `/meeting`：网页版会议页

下载按钮地址可通过环境变量覆盖：

```bash
VITE_APP_DOWNLOAD_URL=https://your-download-page
```

未设置时默认跳转：

```text
https://github.com/chenyongnuan/memo-app/releases
```

## Web 数据架构（已定）

当前数据层采用双轨方案，不做全量替换：

- 桌面端（Tauri）：继续使用本地 SQLite（离线可用）
- Web 端（云端）：使用 HTTP 业务 API + MySQL 8

### MySQL 选型说明

- 第一阶段采用**单机 MySQL 8**（安装在一台服务器）即可满足当前需求
- 不要求首版上主从或分布式，先保障功能闭环与稳定性
- 建议同机部署 Web API 与 MySQL（内网访问），降低网络复杂度

### 最小运维建议（单机）

- 开启每日自动备份（`mysqldump`）
- 仅开放 MySQL 到应用内网，不对公网直接暴露
- 设置基础监控：CPU、磁盘、连接数、慢查询日志

## 会议模块（2026-03-26 更新）

### 当前能力

- 会议主布局：左侧视频主区 + 右侧参会人员列表（桌面端）。
- 小屏自适应：右侧参会列表自动折叠为 `参会人(N)` 抽屉。
- 参会状态：视频画布显示“用户名 + 麦克风/摄像头状态图标”。
- 私聊入口：点击参会人员列表中的成员，可发送定向私聊消息。
- 链接分享：标题栏支持“一键复制会议链接”用于邀请他人网页入会。

### 技术方案（会议）

- 信令层：HTTP 轮询信令（房间维度），承载 Offer/Answer/ICE 与聊天消息。
- 音视频层：WebRTC 点对点连接（STUN），远端流按成员维度管理。
- UI 数据流：
  - `meetingPeers` 作为参会列表与状态展示的统一数据源；
  - 视频画布、参会侧栏、移动端抽屉复用同一份在线成员状态；
  - 私聊消息通过 `chat` 信令类型进行点对点转发。
- 兼容策略：
  - 桌面端：右侧常驻参会列表；
  - 小屏端：抽屉化，避免压缩视频主区域。

## 腾讯云 Nginx 部署脚本

已提供一键脚本（适用于 Ubuntu/CentOS 常见环境）：

```bash
sudo bash scripts/setup-meeting-signal-tencent.sh \
  --domain meet.example.com \
  --project-dir /opt/memo-app \
  --run-user ubuntu \
  --signal-port 8787
```

脚本会自动完成：

- 安装 Nginx
- 安装生产依赖（`npm install --omit=dev`）
- 写入并启动 `meeting-signal` 的 systemd 服务
- 写入并启用 Nginx 反代配置（`/` -> `127.0.0.1:8787`）
- 重载 Nginx 并执行配置检测

模板文件：

- `scripts/nginx-meeting-signal.conf.template`
- `scripts/meeting-signal.service.template`
- `scripts/setup-meeting-signal-tencent.sh`

## 腾讯云 PM2 启动脚本

如果你希望用 PM2 托管会议信令服务（而不是 systemd 单服务），可以使用：

```bash
sudo bash scripts/setup-meeting-signal-pm2-tencent.sh \
  --domain meet.example.com \
  --project-dir /opt/memo-app \
  --run-user root \
  --signal-port 8787
```

该脚本会自动：

- 安装 Nginx
- 安装 Node 生产依赖与 PM2
- 生成并启动 PM2 应用（`meeting-signal`）
- 保存 PM2 进程并配置开机自启
- 写入 Nginx 反代并重载

相关文件：

- `scripts/meeting-signal.pm2.config.template.cjs`
- `scripts/setup-meeting-signal-pm2-tencent.sh`

## 正式打包（macOS + Windows）

仓库内置 GitHub Actions 工作流：`.github/workflows/release-bundles.yml`

- 触发方式
  - 手动触发：`Actions` → `Release Bundles` → `Run workflow`
  - Tag 触发：推送 `v*` 标签（如 `v0.1.1`）
- 产物
  - `macos-bundles`：`.app` + `.dmg`（未签名）
  - `windows-bundles`：`.exe` + `.msi`（未签名）
- 下载位置
  - GitHub Actions 对应运行记录的 `Artifacts` 区域

> 当前是“可安装包”流程，默认不做 Apple 公证/Windows 证书签名。

## 权限说明 (macOS)

应用需要以下系统权限（首次使用时系统会弹窗请求）：

- **麦克风权限**：语音输入功能需要
- **语音识别权限**：将语音转为文字需要
- 权限声明在 `src-tauri/Info.plist` 中配置

## 平台支持

- `macOS`：支持完整功能，包括语音输入
- `Windows`：支持笔记、文件夹、搜索、图片等桌面功能；**不支持语音输入**
