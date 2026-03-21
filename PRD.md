# 备忘录应用 PRD

## 项目概述
基于 Tauri + React + SQLite 的桌面备忘录应用，支持 Markdown 编辑。

## 技术栈
- 前端：React + TypeScript + Zustand
- 后端：Rust + Tauri
- 数据库：SQLite + FTS5 全文搜索
- UI：原生 CSS（精简设计）

---

## 已完成功能

### v0.1.0 - 基础框架 (2026-03-19)

#### 1. 核心功能
- [x] 笔记 CRUD（创建、读取、更新、删除）
- [x] Markdown 编辑器
- [x] Markdown 预览模式
- [x] 全文搜索（标题 + 内容）
- [x] 笔记列表展示

#### 2. 数据模型
- [x] Notes 表：id, title, content, category_id, created_at, updated_at
- [x] Categories 表：id, name, color
- [x] Tags 表：id, name
- [x] Note_Tags 表：note_id, tag_id（多对多关系）
- [x] FTS5 全文搜索索引

#### 3. 后端 API (Tauri Commands)
- [x] `get_notes` - 获取所有笔记
- [x] `create_note` - 创建笔记
- [x] `update_note` - 更新笔���
- [x] `delete_note` - 删除笔记
- [x] `search_notes` - 搜索笔记
- [x] `get_categories` - 获取分类
- [x] `create_category` - 创建分类
- [x] `get_tags` - 获取标签

#### 4. 前端组件
- [x] NoteItem - 笔记列表项
- [x] NoteEditor - 笔记编辑器（支持 Markdown）
- [x] SearchBar - 搜索框
- [x] App - 主应用布局（左侧列表 + 右侧编辑器）

#### 5. 状态管理
- [x] Zustand store：notes, categories, tags, selectedNote, searchQuery

---

## 开发中功能

### v0.2.0 - 标签功能完善

#### 1. 标签管理
- [x] 创建标签
- [x] 删除标签
- [x] 标签列表展示

#### 2. 笔记标签关联
- [x] 给笔记添加标签
- [x] 从笔记移除标签
- [x] 笔记详情显示标签

#### 3. 标签筛选
- [x] 按标签筛选笔记（后端 API 已实现）
- [ ] 前端标签筛选 UI

---

## 待开发功能

### v0.3.0 - 分类管理

- [x] 分类 CRUD
- [x] 分类颜色选择器
- [x] 按分类筛选笔记
- [x] 分类在界面中显示

### v0.4.0 - UI 优化
- [ ] 代码高亮（Markdown 代码块）
- [ ] 编辑器快捷键（Ctrl+B 加粗等）
- [ ] 笔记列表显示日期
- [ ] 笔记列表显示分类和标签
- [ ] 深色模式支持

### v0.5.0 - 实用功能
- [x] 自动保存（1秒延迟，debounce）
- [x] 图片粘贴支持（Ctrl+V 粘贴图片）
- [ ] 导出笔记为 Markdown 文件
- [ ] 导入 Markdown 文件
- [ ] 全局快捷键（新建、搜索等）
- [ ] 笔记置顶功能
- [ ] 笔记排序（按时间、标题等）

### v0.6.0 - 数据安全
- [ ] 自动保存（防止数据丢失）
- [ ] 数据备份功能
- [ ] 回收站（软删除）
- [ ] 数据恢复

---

## 设计原则
1. **精简优先**：不过度设计，只实现必要功能
2. **性能优先**：利用 SQLite FTS5 实现快速搜索
3. **用户体验**：Markdown 编辑流畅，界面简洁
4. **数据安全**：本地存储，数据完全掌控

---

## 更新日志
- 2026-03-19: 完成基础框架 v0.1.0
- 2026-03-19: 完成标签功能 v0.2.0
- 2026-03-19: 完成分类管理 v0.3.0
- 2026-03-19: 完成实用功能 v0.5.0（自动保存、图片粘贴）
- 2026-03-19: 修复关键问题：
  - 修复 NoteEditor 状态同步问题
  - 使用 FTS5 实现全文搜索
  - 添加 Toast 错误提示
  - 修复 React useEffect 依赖问题
  - 修复保存失败问题并添加详细日志
  - 移除��览按钮简化界面
