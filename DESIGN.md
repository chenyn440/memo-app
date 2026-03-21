# Design System — Memo App

## Product Context
- **What this is:** macOS 桌面备忘录应用，支持 Markdown 编辑、分类/标签管理、图片粘贴、语音输入
- **Who it's for:** 希望用简洁工具管理笔记的人（开发者、知识工作者）
- **Space/industry:** 个人笔记工具（Bear, Obsidian, Craft, Apple Notes 同赛道）
- **Project type:** 桌面应用（Tauri + React）

## Aesthetic Direction
- **Direction:** Brutally Minimal + Warmth（极简但温暖）
- **Decoration level:** minimal — 排版和留白做所有的事
- **Mood:** 像一本质感好的纸质手帐。安静、专注、私密。不是"科技产品"，是"你的笔记本"
- **Reference sites:** bear.app (温暖感), obsidian.md (专注感), craft.do (质感)

## Typography
- **Display/Hero:** DM Sans 700 — 温暖的人文几何无衬线，标题用
- **Body:** DM Sans 400/500 — 正文，清晰易读，中文回退到系统字体 PingFang SC
- **UI/Labels:** DM Sans 500 — 按钮、标签等 UI 元素
- **Data/Tables:** DM Sans (tabular-nums) — 日期、数字等
- **Code:** JetBrains Mono 400 — Markdown 代码块和编辑器
- **Loading:** Google Fonts CDN — `https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400&display=swap`
- **Scale:**
  - xs: 11px / 0.6875rem — 辅助文字、时间戳
  - sm: 12px / 0.75rem — 标签、按钮小字
  - base: 14px / 0.875rem — 正文、列表项
  - md: 16px / 1rem — 编辑器正文
  - lg: 20px / 1.25rem — 笔记标题
  - xl: 24px / 1.5rem — 页面标题

## Color
- **Approach:** restrained — 一个强调色 + 暖中性色，颜色稀少且有意义
- **Primary:** `#B87B5A` — 暖铜/陶土色，用于主操作按钮、选中状态、强调
- **Primary hover:** `#A56D4E` — 深一度
- **Primary light:** `#F5EDE6` — 选中背景、hover 状态
- **Neutrals (warm stone):**
  - `#FAF8F5` — 页面背景（暖白，像优质纸张）
  - `#FFFFFF` — 卡片/表面
  - `#F2EEEA` — 侧边栏背景
  - `#E8E2DB` — 边框、分隔线
  - `#D4CCC3` — 禁用状态
  - `#8C8078` — 次要文字
  - `#5C5550` — 次要文字（深色）
  - `#2C2520` — 主要文字（暖近黑）
- **Semantic:**
  - success: `#5A9E6F` — 保存成功、创建成功
  - warning: `#D4A04A` — 注意、提醒
  - error: `#C75450` — 保存失败、删除确认
  - info: `#6B8EBF` — 提示信息
- **Dark mode strategy:** 反转表面层级，降低饱和度 10-20%
  - 背景: `#1C1A18`
  - 表面: `#262320`
  - 边框: `#3D3935`
  - 主要文字: `#E8E2DB`
  - 次要文字: `#8C8078`
  - Primary: `#C9936E`（提亮以保证对比度）

## Spacing
- **Base unit:** 4px
- **Density:** comfortable
- **Scale:**
  - 2xs: 2px
  - xs: 4px
  - sm: 8px
  - md: 16px
  - lg: 24px
  - xl: 32px
  - 2xl: 48px
  - 3xl: 64px

## Layout
- **Approach:** grid-disciplined — 清晰的分栏，可预测的对齐
- **Grid:** 左侧边栏 280px + 右编辑区 fluid
- **Max content width:** 编辑器内容区 720px
- **Border radius:**
  - sm: 4px — 输入框、小按钮
  - md: 8px — 卡片、笔记列表项
  - lg: 12px — 模态框、大容器
  - full: 9999px — 标签药丸、头像

## Motion
- **Approach:** minimal-functional — 只有帮助理解的过渡，没有装饰性动画
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:**
  - micro: 80ms — hover 状态、颜色变化
  - short: 150ms — 按钮状态、选中切换
  - medium: 250ms — 面板展开、toast 出现
  - long: 400ms — 模态框进出

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-20 | 初始设计系统创建 | 基于 Bear/Obsidian/Craft 竞品研究，选择"温暖手帐"方向区分竞品 |
| 2026-03-20 | 暖铜色 #B8765A 替代蓝色 #5b8def | 竞品全是冷色（蓝/紫），暖色调是最大的视觉差异化 |
| 2026-03-20 | DM Sans 替代系统默认字体 | 温暖人文风格，与暖色调一致，中文回退到 PingFang SC |
