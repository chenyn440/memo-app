# 代码审查报告

## 📊 整体评估

**质量评分**: 7.5/10
**审查文件数**: 15
**发现问题**: 严重: 0, 高: 2, 中: 5, 低: 4

**总结**: 代码整体结构清晰，遵循了精简设计原则。Rust 后端使用了合理的错误处理，React 前端组件职责明确。主要问题集中在状态同步、错误处理和用户体验优化方面。

---

## 🟠 高优先级问题

### 问题 1: NoteEditor 状态未同步
**文件**: `src/components/NoteEditor.tsx:10-13`
**严重程度**: 高
**分类**: 代码质量

**问题**:
当 `note` prop 变化时，组件内部的 `title` 和 `content` 状态不会更新。用户切换笔记后，编辑器仍显示旧内容。

**为什么重要**:
这会导致严重的用户体验问题：用户选择新笔记后，编辑器显示的是上一个笔记的内容，可能导致误编辑和数据混乱。

**修复建议**:
```tsx
// Before
export function NoteEditor({ note, onSave }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [isPreview, setIsPreview] = useState(false);

// After
export function NoteEditor({ note, onSave }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    setTitle(note?.title || '');
    setContent(note?.content || '');
    setIsPreview(false);
  }, [note?.id]);
```

---

### 问题 2: SQL 注入风险（理论上）
**文件**: `src-tauri/src/commands.rs:多处`
**严重程度**: 高
**分类**: 安全

**问题**:
虽然使用了参数化查询（`?1`, `?2`），但 `search_notes` 函数使用 `LIKE` 查询，可能存在通配符注入风险。

**为什么重要**:
恶意用户可能输入特殊字符（如 `%`, `_`）导致意外的搜索结果或性能问题。

**修复建议**:
```rust
// Before
pub fn search_notes(query: String, state: State<AppState>) -> Result<Vec<Note>, String> {
    let search_query = format!("%{}%", query);
    // ...

// After
pub fn search_notes(query: String, state: State<AppState>) -> Result<Vec<Note>, String> {
    // 转义特殊字符
    let escaped = query.replace("%", "\\%").replace("_", "\\_");
    let search_query = format!("%{}%", escaped);
    // 或者使用 FTS5 全文搜索（已有表但未使用）
```

**额外建议**:
你已经创建了 `notes_fts` 表，应该使用它来实现更安全高效的搜索：
```rust
let mut stmt = conn.prepare(
    "SELECT n.id, n.title, n.content, n.category_id, n.created_at, n.updated_at
     FROM notes n
     JOIN notes_fts ON notes_fts.rowid = n.id
     WHERE notes_fts MATCH ?1
     ORDER BY n.updated_at DESC"
)?;
```

---

## 🟡 中优先级问题

### 问题 3: 缺少加载状态
**文件**: `src/components/TagManager.tsx`, `src/App.tsx`
**严重程度**: 中
**分类**: 用户体验

**问题**:
所有异步操作都没有加载状态指示，用户不知道操作是否正在进行。

**修复建议**:
添加 loading 状态：
```tsx
const [isLoading, setIsLoading] = useState(false);

const handleAddTag = async (tagId: number) => {
  if (!noteId) return;
  setIsLoading(true);
  try {
    await api.addTagToNote(noteId, tagId);
    loadNoteTags();
  } catch (error) {
    console.error('Failed to add tag:', error);
  } finally {
    setIsLoading(false);
  }
};
```

---

### 问题 4: ��误处理不完善
**文件**: 所有 React 组件
**严重程度**: 中
**分类**: 用户体验

**问题**:
所有错误只是 `console.error`，用户看不到任何错误提示。

**修复建议**:
添加错误提示机制（Toast 或 Alert）：
```tsx
const [error, setError] = useState<string | null>(null);

const handleAddTag = async (tagId: number) => {
  try {
    await api.addTagToNote(noteId, tagId);
    loadNoteTags();
  } catch (error) {
    setError('添加标签失败，请重试');
  }
};

// 在 UI 中显示
{error && <div className="error-message">{error}</div>}
```

---

### 问题 5: 数据库连接未池化
**文件**: `src-tauri/src/lib.rs:22`
**严重程度**: 中
**分类**: 性能

**问题**:
使用单个 `Mutex<Connection>`，所有请求串行执行，可能成为性能瓶颈。

**为什么重要**:
虽然是桌面应用，但频繁的数据库操作（如搜索、标签加载）会相互阻塞。

**修复建��**:
考虑使用连接池（如 `r2d2`）或者接受当前设计（对于单用户桌面应用可能足够）。

---

### 问题 6: 重复的数据库查询代码
**文件**: `src-tauri/src/commands.rs`
**严重程度**: 中
**分类**: 代码质量 (DRY)

**问题**:
`Note` 的查询映射代码重复出现 4 次（get_notes, update_note, search_notes, get_notes_by_tag）。

**修复建议**:
提取为辅助函数：
```rust
fn map_note_row(row: &rusqlite::Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: row.get(0)?,
        title: row.get(1)?,
        content: row.get(2)?,
        category_id: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

// 使用
let notes = stmt.query_map([], map_note_row)?
    .collect::<Result<Vec<_>, _>>()?;
```

---

### 问题 7: TagManager 中的 useEffect 缺少依赖
**文件**: `src/components/TagManager.tsx:19-25`
**严重程度**: 中
**分类**: React 最佳实践

**问题**:
`loadNoteTags` 函数在 useEffect 中调用，但不在依赖数组中。

**修复建议**:
```tsx
useEffect(() => {
  if (noteId) {
    loadNoteTags();
  } else {
    setNoteTags([]);
  }
}, [noteId, loadNoteTags]); // 添加 loadNoteTags

// ��者使用 useCallback
const loadNoteTags = useCallback(async () => {
  if (!noteId) return;
  try {
    const tags = await api.getNoteTags(noteId);
    setNoteTags(tags);
  } catch (error) {
    console.error('Failed to load note tags:', error);
  }
}, [noteId]);
```

---

## 🟢 低优先级问题

### 问题 8: 内联样式过多
**文件**: 所有 React 组件
**严重程度**: 低
**分类**: 代码风格

**问题**:
大量使用内联样式，代码冗长且难以维护。

**建议**:
考虑使用 CSS 模块或 styled-components，或至少提取常用样式为常量。

---

### 问题 9: 魔法数字
**文件**: `src/components/NoteItem.tsx:19`
**严重程度**: 低
**分类**: 代码可读性

**问题**:
```tsx
{note.content.substring(0, 50)}...
```

**建议**:
```tsx
const PREVIEW_LENGTH = 50;
{note.content.substring(0, PREVIEW_LENGTH)}...
```

---

### 问题 10: 缺少 TypeScript 严格模式
**文件**: `tsconfig.json`
**严重程度**: 低
**分类**: 代码质量

**建议**:
启用严格模式以捕获更多潜在问题：
```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

---

### 问题 11: 未使用的 FTS5 表
**文件**: `src-tauri/src/db/mod.rs:44-49`
**严重程度**: 低
**分类**: 代码质量

**问题**:
创建了 `notes_fts` 全文搜索表，但 `search_notes` 使用的是简单的 `LIKE` 查询。

**建议**:
要么使用 FTS5，要么删除该表定义。

---

## ✅ 优点

- **清晰的架构**: 前后端分离，���责明确
- **类型安全**: TypeScript + Rust 提供了良好的类型保护
- **精简设计**: 没有过度工程化，代码简洁
- **参数化查询**: Rust 后端正确使用了参数化查询防止 SQL 注入
- **组件复用**: React 组件设计合理，易于复用
- **错误处理**: Rust 端使用 `Result` 类型进行错误处理

---

## 💡 建议

### 立即处理:
1. 修复 NoteEditor 状态同步问题（影响核心功能）
2. 添加基本的错误提示给用户

### 短期改进:
1. 使用 FTS5 实现更好的搜索
2. 添加加载状态指示
3. 提取重复的数据库查询代码

### 长期优化:
1. 考虑添加自动保存功能
2. 优化样式管理（CSS 模块或 Tailwind）
3. 添加单元测试

---

## 📚 相关资源

- [React useEffect 最佳实践](https://react.dev/reference/react/useEffect)
- [SQLite FTS5 文档](https://www.sqlite.org/fts5.html)
- [Rust 错误处理模式](https://doc.rust-lang.org/book/ch09-00-error-handling.html)
