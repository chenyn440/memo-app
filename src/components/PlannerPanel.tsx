import { useEffect, useMemo, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { api } from '../utils/api';
import {
  MeetingRoom, Note, Plan, PlanItem, PlanPriority, PlanStatus, PlanType,
  CreatePlanItemInput
} from '../types';
import { showToast } from './Toast';

type PlannerView = 'list' | 'board' | 'calendar' | 'flow';
type ReminderState = 'normal' | 'due_soon' | 'overdue';
const PLANNER_SETTINGS_EXPANDED_KEY = 'plannerSettingsExpanded';

interface PlannerPanelProps {
  notes: Note[];
  onOpenNote: (noteId: number) => void;
  onSwitchToNotes: () => void;
  onStartMeeting?: (ctx: { item: PlanItem; room: MeetingRoom; token: string }) => void;
  hidePlanSidebar?: boolean;
  selectedPlanId?: number | null;
  onSelectedPlanIdChange?: (id: number | null) => void;
  onPlansLoaded?: (plans: Plan[]) => void;
}

const STATUS_OPTIONS: Array<{ value: PlanStatus; label: string }> = [
  { value: 'todo', label: '待办' },
  { value: 'in_progress', label: '进行中' },
  { value: 'done', label: '已完成' },
  { value: 'cancelled', label: '已取消' },
];

const PRIORITY_OPTIONS: Array<{ value: PlanPriority; label: string }> = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const PLAN_TYPE_LABELS: Record<PlanType, string> = {
  project: '项目',
  event: '事件',
  meeting: '会议',
};

function toIsoValue(local?: string): string | undefined {
  if (!local?.trim()) return undefined;
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function getReminderState(item: PlanItem): ReminderState {
  if (!item.due_at || item.status === 'done' || item.status === 'cancelled') return 'normal';
  const due = new Date(item.due_at).getTime();
  if (Number.isNaN(due)) return 'normal';
  const now = Date.now();
  if (due < now) return 'overdue';
  if (due - now <= 24 * 60 * 60 * 1000) return 'due_soon';
  return 'normal';
}

function getItemFlowTimestamp(item: PlanItem): number {
  const dateValue = item.start_at || item.due_at || item.created_at || '';
  const ts = new Date(dateValue).getTime();
  return Number.isNaN(ts) ? Number.MAX_SAFE_INTEGER : ts;
}

export function PlannerPanel({
  notes,
  onOpenNote,
  onSwitchToNotes: _onSwitchToNotes,
  onStartMeeting,
  hidePlanSidebar = false,
  selectedPlanId: selectedPlanIdProp,
  onSelectedPlanIdChange,
  onPlansLoaded,
}: PlannerPanelProps) {
  const [view, setView] = useState<PlannerView>('list');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlanIdInner, setSelectedPlanIdInner] = useState<number | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);

  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanType, setNewPlanType] = useState<PlanType>('project');

  const [draftTitle, setDraftTitle] = useState('');
  const [draftType, setDraftType] = useState<'task' | 'milestone' | 'risk' | 'meeting'>('task');
  const [draftStatus, setDraftStatus] = useState<PlanStatus>('todo');
  const [draftPriority, setDraftPriority] = useState<PlanPriority>('medium');
  const [draftOwner, setDraftOwner] = useState('');
  const [draftStartAt, setDraftStartAt] = useState('');
  const [draftDueAt, setDraftDueAt] = useState('');
  const [draftNotes, setDraftNotes] = useState('');
  const [draftLinkedNoteId, setDraftLinkedNoteId] = useState<number | ''>('');
  const [draftMeetingPlatform, setDraftMeetingPlatform] = useState('腾讯会议');
  const [draftMeetingUrl, setDraftMeetingUrl] = useState('');
  const [draftMeetingId, setDraftMeetingId] = useState('');
  const [draftMeetingPassword, setDraftMeetingPassword] = useState('');
  const [draftMeetingAttendees, setDraftMeetingAttendees] = useState('');
  const [draftMeetingRecordingUrl, setDraftMeetingRecordingUrl] = useState('');
  const [showAdvancedForm, setShowAdvancedForm] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<PlanStatus>('todo');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const selectedPlanId = selectedPlanIdProp !== undefined ? selectedPlanIdProp : selectedPlanIdInner;

  const setSelectedPlanId = (id: number | null) => {
    setSelectedPlanIdInner(id);
    onSelectedPlanIdChange?.(id);
  };

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId]
  );

  const boardColumns = useMemo(
    () => STATUS_OPTIONS.map((status) => ({
      ...status,
      items: items.filter((item) => item.status === status.value),
    })),
    [items]
  );

  const calendarGroups = useMemo(() => {
    const grouped = new Map<string, PlanItem[]>();
    items.forEach((item) => {
      const key = (item.due_at || item.start_at || '').slice(0, 10);
      if (!key) return;
      const list = grouped.get(key) ?? [];
      list.push(item);
      grouped.set(key, list);
    });
    return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);

  const flowItems = useMemo(
    () => [...items].sort((a, b) => getItemFlowTimestamp(a) - getItemFlowTimestamp(b)),
    [items]
  );
  const draftDuePreview = useMemo(() => {
    if (!draftDueAt) return '未设置';
    const date = new Date(draftDueAt);
    if (Number.isNaN(date.getTime())) return draftDueAt;
    return date.toLocaleString();
  }, [draftDueAt]);

  const refreshPlans = async (nextSelectedId?: number | null) => {
    setLoading(true);
    try {
      const data = await api.getPlans();
      setPlans(data);
      onPlansLoaded?.(data);
      if (nextSelectedId !== undefined) {
        setSelectedPlanId(nextSelectedId);
      } else if (!selectedPlanId && data.length > 0) {
        setSelectedPlanId(data[0].id);
      } else if (selectedPlanId && !data.some((p) => p.id === selectedPlanId)) {
        setSelectedPlanId(data[0]?.id ?? null);
      }
    } catch (error) {
      console.error('Failed to load plans:', error);
      showToast('加载计划失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  const refreshItems = async (planId: number | null) => {
    if (!planId) {
      setItems([]);
      return;
    }
    try {
      const data = await api.getPlanItems(planId);
      setItems(data);
    } catch (error) {
      console.error('Failed to load plan items:', error);
      showToast('加载计划项失败', 'error');
    }
  };

  useEffect(() => {
    void refreshPlans();
  }, []);

  useEffect(() => {
    void refreshItems(selectedPlanId);
  }, [selectedPlanId]);

  useEffect(() => {
    if (selectedPlanIdProp !== undefined && selectedPlanIdProp !== selectedPlanIdInner) {
      setSelectedPlanIdInner(selectedPlanIdProp);
    }
  }, [selectedPlanIdProp, selectedPlanIdInner]);

  useEffect(() => {
    if (selectedPlan?.plan_type === 'meeting') {
      setDraftType('meeting');
    } else {
      setDraftType('task');
    }
  }, [selectedPlanId, selectedPlan?.plan_type]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PLANNER_SETTINGS_EXPANDED_KEY);
      if (raw === 'true') {
        setSettingsExpanded(true);
      } else if (raw === 'false') {
        setSettingsExpanded(false);
      }
    } catch (error) {
      console.error('Failed to read planner settings expanded state:', error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(PLANNER_SETTINGS_EXPANDED_KEY, settingsExpanded ? 'true' : 'false');
    } catch (error) {
      console.error('Failed to persist planner settings expanded state:', error);
    }
  }, [settingsExpanded]);

  const handleCreatePlan = async () => {
    const name = newPlanName.trim();
    if (!name) {
      showToast('请输入计划名称', 'info');
      return;
    }
    setCreatingPlan(true);
    try {
      const created = await api.createPlan({ name, plan_type: newPlanType });
      setNewPlanName('');
      setNewPlanType('project');
      await refreshPlans(created.id);
      showToast('已创建计划', 'success');
    } catch (error: any) {
      console.error('Failed to create plan:', error);
      const message = String(error?.message || '');
      if (message.includes('no such table: plans') || message.includes('no such table: plan_items')) {
        showToast('数据库结构未更新，请重启应用后重试', 'error');
      } else {
        showToast(message || '创建计划失败', 'error');
      }
    } finally {
      setCreatingPlan(false);
    }
  };

  const handleDeletePlan = async (planId: number) => {
    try {
      await api.deletePlan(planId);
      await refreshPlans();
      showToast('已删除计划', 'success');
    } catch (error) {
      console.error('Failed to delete plan:', error);
      showToast('删除计划失败', 'error');
    }
  };

  const handleCreateItem = async () => {
    if (!selectedPlanId || !draftTitle.trim()) return;
    const input: CreatePlanItemInput = {
      plan_id: selectedPlanId,
      title: draftTitle.trim(),
      item_type: draftType,
      status: draftStatus,
      priority: draftPriority,
      owner: draftOwner.trim() || undefined,
      start_at: toIsoValue(draftStartAt),
      due_at: toIsoValue(draftDueAt),
      notes: draftNotes.trim() || undefined,
      linked_note_id: draftLinkedNoteId === '' ? undefined : draftLinkedNoteId,
      meeting_platform: draftType === 'meeting' ? (draftMeetingPlatform.trim() || undefined) : undefined,
      meeting_url: draftType === 'meeting' ? (draftMeetingUrl.trim() || undefined) : undefined,
      meeting_id: draftType === 'meeting' ? (draftMeetingId.trim() || undefined) : undefined,
      meeting_password: draftType === 'meeting' ? (draftMeetingPassword.trim() || undefined) : undefined,
      meeting_attendees: draftType === 'meeting' ? (draftMeetingAttendees.trim() || undefined) : undefined,
      meeting_recording_url: draftType === 'meeting' ? (draftMeetingRecordingUrl.trim() || undefined) : undefined,
    };
    try {
      await api.createPlanItem(input);
      setDraftTitle('');
      setDraftOwner('');
      setDraftStartAt('');
      setDraftDueAt('');
      setDraftNotes('');
      setDraftLinkedNoteId('');
      setDraftMeetingPlatform('腾讯会议');
      setDraftMeetingUrl('');
      setDraftMeetingId('');
      setDraftMeetingPassword('');
      setDraftMeetingAttendees('');
      setDraftMeetingRecordingUrl('');
      setShowAdvancedForm(false);
      await refreshItems(selectedPlanId);
      showToast('已新增计划项', 'success');
    } catch (error) {
      console.error('Failed to create plan item:', error);
      showToast('新增计划项失败', 'error');
    }
  };

  const handleUpdateItemStatus = async (item: PlanItem, status: PlanStatus) => {
    if (item.status === status) return;
    try {
      await api.updatePlanItem({
        id: item.id,
        title: item.title,
        item_type: item.item_type,
        status,
        priority: item.priority,
        owner: item.owner || undefined,
        start_at: item.start_at || undefined,
        due_at: item.due_at || undefined,
        notes: item.notes || undefined,
        linked_note_id: item.linked_note_id || undefined,
        meeting_platform: item.meeting_platform || undefined,
        meeting_url: item.meeting_url || undefined,
        meeting_id: item.meeting_id || undefined,
        meeting_password: item.meeting_password || undefined,
        meeting_attendees: item.meeting_attendees || undefined,
        meeting_recording_url: item.meeting_recording_url || undefined,
      });
      await refreshItems(selectedPlanId);
    } catch (error) {
      console.error('Failed to update item status:', error);
      showToast('更新状态失败', 'error');
    }
  };

  const handleDeleteItem = async (id: number) => {
    try {
      await api.deletePlanItem(id);
      await refreshItems(selectedPlanId);
    } catch (error) {
      console.error('Failed to delete item:', error);
      showToast('删除计划项失败', 'error');
    }
  };

  const handleStartMeeting = async (item: PlanItem) => {
    try {
      const room = await api.getOrCreateMeetingRoom(item.id, item.title || '会议');
      const startedRoom = await api.startMeetingRoom(room.id);
      const token = await api.issueMeetingToken(startedRoom.id, '本地用户');
      if (onStartMeeting) {
        onStartMeeting({ item, room: startedRoom, token });
        return;
      }
      const meetingUrl = item.meeting_url?.trim();
      if (meetingUrl) {
        await openUrl(meetingUrl);
        return;
      }
      showToast('会议页面未接入，且未设置外部会议链接', 'info');
    } catch (error) {
      console.error('Failed to start meeting:', error);
      showToast('进入会议失败', 'error');
    }
  };

  const handleBulkUpdateStatus = async () => {
    if (!selectedPlanId) return;
    if (items.length === 0) {
      showToast('当前计划没有可更新的计划项', 'info');
      return;
    }
    const targetItems = items.filter((item) => item.status !== bulkStatus);
    if (targetItems.length === 0) {
      showToast('所有计划项已是该状态', 'info');
      return;
    }
    setBulkUpdating(true);
    try {
      await Promise.all(
        targetItems.map((item) =>
          api.updatePlanItem({
            id: item.id,
            title: item.title,
            item_type: item.item_type,
            status: bulkStatus,
            priority: item.priority,
            owner: item.owner || undefined,
            start_at: item.start_at || undefined,
            due_at: item.due_at || undefined,
            notes: item.notes || undefined,
            linked_note_id: item.linked_note_id || undefined,
            meeting_platform: item.meeting_platform || undefined,
            meeting_url: item.meeting_url || undefined,
            meeting_id: item.meeting_id || undefined,
            meeting_password: item.meeting_password || undefined,
            meeting_attendees: item.meeting_attendees || undefined,
            meeting_recording_url: item.meeting_recording_url || undefined,
          })
        )
      );
      await refreshItems(selectedPlanId);
      showToast(`已批量更新 ${targetItems.length} 项`, 'success');
    } catch (error) {
      console.error('Failed to bulk update item status:', error);
      showToast('批量更新状态失败', 'error');
    } finally {
      setBulkUpdating(false);
    }
  };

  const renderItemRow = (item: PlanItem) => {
    const reminderState = getReminderState(item);
    const shouldShowMeetingEntry = selectedPlan?.plan_type === 'meeting';
    return (
      <div key={item.id} className={`planner-item-row ${reminderState}`}>
        <div className="planner-item-main">
          <div className="planner-item-title">{item.title}</div>
          <div className="planner-item-meta">
            <span>{STATUS_OPTIONS.find((s) => s.value === item.status)?.label ?? item.status}</span>
            <span>优先级 {PRIORITY_OPTIONS.find((p) => p.value === item.priority)?.label ?? item.priority}</span>
            {item.owner && <span>负责人 {item.owner}</span>}
            {item.due_at && <span>截止 {new Date(item.due_at).toLocaleString()}</span>}
            {item.item_type === 'meeting' && item.meeting_platform && <span>平台 {item.meeting_platform}</span>}
          </div>
        </div>
        <div className="planner-item-actions">
          <select
            value={item.status}
            onChange={(e) => void handleUpdateItemStatus(item, e.target.value as PlanStatus)}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status.value} value={status.value}>{status.label}</option>
            ))}
          </select>
          {item.linked_note_id && (
            <button onClick={() => onOpenNote(item.linked_note_id!)}>打开笔记</button>
          )}
          {shouldShowMeetingEntry && (
            <button
              type="button"
              className="planner-start-meeting-btn"
              onClick={() => void handleStartMeeting(item)}
            >
              开始会议
            </button>
          )}
          <button
            className="planner-delete-icon-btn"
            onClick={() => void handleDeleteItem(item.id)}
            title="删除计划项"
            aria-label="删除计划项"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M18 7L17.3 18.2C17.2368 19.2109 16.3985 20 15.3857 20H8.61426C7.60146 20 6.76317 19.2109 6.69998 18.2L6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M10 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M14 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="planner-layout">
      <div className="planner-header">
        <div className="planner-title-wrap">
          <h2>计划模块</h2>
          <span>{loading ? '加载中...' : `共 ${plans.length} 个计划`}</span>
        </div>
        <div className="planner-create-plan">
          <input
            value={newPlanName}
            onChange={(e) => setNewPlanName(e.target.value)}
            placeholder="新建计划名称"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreatePlan();
              }
            }}
          />
          <select value={newPlanType} onChange={(e) => setNewPlanType(e.target.value as PlanType)}>
            <option value="project">项目计划</option>
            <option value="event">事件计划</option>
            <option value="meeting">会议计划</option>
          </select>
          <button onClick={() => void handleCreatePlan()} disabled={creatingPlan}>
            {creatingPlan ? '创建中...' : '创建计划'}
          </button>
        </div>
      </div>

      <div className="planner-body">
        {!hidePlanSidebar && (
          <aside className="planner-side">
            {plans.map((plan) => (
              <div key={plan.id} className={`planner-side-item ${selectedPlanId === plan.id ? 'active' : ''}`}>
                <button onClick={() => setSelectedPlanId(plan.id)}>
                  <span>{plan.name}</span>
                  <small>{PLAN_TYPE_LABELS[plan.plan_type] ?? plan.plan_type}</small>
                </button>
                <button
                  className="planner-delete-icon-btn"
                  onClick={() => void handleDeletePlan(plan.id)}
                  title="删除计划"
                  aria-label="删除计划"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                    <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M9 7V5C9 4.44772 9.44772 4 10 4H14C14.5523 4 15 4.44772 15 5V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M18 7L17.3 18.2C17.2368 19.2109 16.3985 20 15.3857 20H8.61426C7.60146 20 6.76317 19.2109 6.69998 18.2L6 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M10 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    <path d="M14 11V16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </aside>
        )}

        <section className="planner-main">
          {selectedPlan ? (
            <>
              <div className={`planner-settings-bar ${settingsExpanded ? 'expanded' : 'collapsed'}`}>
                <div className="planner-settings-head">
                  <div className="planner-settings-title">计划设置</div>
                  <button
                    type="button"
                    className="planner-ghost-btn planner-settings-toggle"
                    onClick={() => setSettingsExpanded((prev) => !prev)}
                  >
                    {settingsExpanded ? '收起设置' : '展开设置'}
                  </button>
                </div>

                {settingsExpanded ? (
                  <>
                    <div className="planner-create-item">
                      <input value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} placeholder="计划项标题（必填）" />
                      <select value={draftStatus} onChange={(e) => setDraftStatus(e.target.value as PlanStatus)}>
                        {STATUS_OPTIONS.map((status) => (
                          <option key={status.value} value={status.value}>{status.label}</option>
                        ))}
                      </select>
                      <input type="datetime-local" value={draftDueAt} onChange={(e) => setDraftDueAt(e.target.value)} />
                      <button
                        type="button"
                        className="planner-ghost-btn"
                        onClick={() => setShowAdvancedForm((prev) => !prev)}
                      >
                        {showAdvancedForm ? '收起高级项' : '更多选项'}
                      </button>
                      <button onClick={() => void handleCreateItem()}>新增计划项</button>
                    </div>
                    {showAdvancedForm && (
                      <div className="planner-advanced-form">
                        <select value={draftType} onChange={(e) => setDraftType(e.target.value as 'task' | 'milestone' | 'risk' | 'meeting')}>
                          <option value="task">任务</option>
                          <option value="milestone">里程碑</option>
                          <option value="risk">风险</option>
                          <option value="meeting">会议</option>
                        </select>
                        <select value={draftPriority} onChange={(e) => setDraftPriority(e.target.value as PlanPriority)}>
                          {PRIORITY_OPTIONS.map((priority) => (
                            <option key={priority.value} value={priority.value}>{priority.label}</option>
                          ))}
                        </select>
                        <input value={draftOwner} onChange={(e) => setDraftOwner(e.target.value)} placeholder="负责人（可选）" />
                        <input type="datetime-local" value={draftStartAt} onChange={(e) => setDraftStartAt(e.target.value)} />
                        <select
                          value={draftLinkedNoteId}
                          onChange={(e) => setDraftLinkedNoteId(e.target.value ? Number(e.target.value) : '')}
                        >
                          <option value="">关联笔记（可选）</option>
                          {notes.map((note) => (
                            <option key={note.id} value={note.id}>{note.title || `笔记 #${note.id}`}</option>
                          ))}
                        </select>
                        <input value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} placeholder="备注（可选）" />
                      </div>
                    )}
                    {showAdvancedForm && draftType === 'meeting' && (
                      <div className="planner-advanced-form planner-meeting-form">
                        <select value={draftMeetingPlatform} onChange={(e) => setDraftMeetingPlatform(e.target.value)}>
                          <option value="腾讯会议">腾讯会议</option>
                          <option value="飞书会议">飞书会议</option>
                          <option value="Zoom">Zoom</option>
                          <option value="Google Meet">Google Meet</option>
                          <option value="其他">其他</option>
                        </select>
                        <input
                          value={draftMeetingUrl}
                          onChange={(e) => setDraftMeetingUrl(e.target.value)}
                          placeholder="会议链接（https://...）"
                        />
                        <input value={draftMeetingId} onChange={(e) => setDraftMeetingId(e.target.value)} placeholder="会议号（可选）" />
                        <input value={draftMeetingPassword} onChange={(e) => setDraftMeetingPassword(e.target.value)} placeholder="会议密码（可选）" />
                        <input value={draftMeetingAttendees} onChange={(e) => setDraftMeetingAttendees(e.target.value)} placeholder="参会人（逗号分隔，可选）" />
                        <input value={draftMeetingRecordingUrl} onChange={(e) => setDraftMeetingRecordingUrl(e.target.value)} placeholder="录制链接（可选）" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="planner-settings-summary">
                    <span>标题：{draftTitle.trim() || '未填写'}</span>
                    <span>状态：{STATUS_OPTIONS.find((s) => s.value === draftStatus)?.label ?? draftStatus}</span>
                    <span>截止：{draftDuePreview}</span>
                  </div>
                )}
              </div>

              <div className="planner-toolbar">
                <div className="planner-view-switch">
                  <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>列表</button>
                  <button className={view === 'board' ? 'active' : ''} onClick={() => setView('board')}>看板</button>
                  <button className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>日历</button>
                  <button className={view === 'flow' ? 'active' : ''} onClick={() => setView('flow')}>流程图</button>
                </div>
                <div className="planner-bulk-status">
                  <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as PlanStatus)}>
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status.value} value={status.value}>{status.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="planner-bulk-apply-btn"
                    onClick={() => void handleBulkUpdateStatus()}
                    disabled={bulkUpdating || items.length === 0}
                  >
                    {bulkUpdating ? '更新中...' : `批量更新(${items.length})`}
                  </button>
                </div>
              </div>

              {view === 'list' && (
                <div className="planner-list-view">
                  {items.length === 0 ? <div className="planner-empty">暂无计划项</div> : items.map(renderItemRow)}
                </div>
              )}

              {view === 'board' && (
                <div className="planner-board-view">
                  {boardColumns.map((col) => (
                    <div key={col.value} className="planner-board-col">
                      <h4>{col.label}</h4>
                      {col.items.length === 0 && <div className="planner-empty">无</div>}
                      {col.items.map((item) => (
                        <div key={item.id} className={`planner-board-card ${getReminderState(item)}`}>
                          <div className="planner-item-title">{item.title}</div>
                          <div className="planner-item-meta">
                            <span>{item.due_at ? new Date(item.due_at).toLocaleDateString() : '无截止'}</span>
                            <span>优先级 {item.priority}</span>
                            {item.item_type === 'meeting' && item.meeting_platform && <span>{item.meeting_platform}</span>}
                          </div>
                          <div className="planner-item-actions">
                            <select
                              value={item.status}
                              onChange={(e) => void handleUpdateItemStatus(item, e.target.value as PlanStatus)}
                            >
                              {STATUS_OPTIONS.map((status) => (
                                <option key={status.value} value={status.value}>{status.label}</option>
                              ))}
                            </select>
                            {selectedPlan?.plan_type === 'meeting' && (
                              <button
                                type="button"
                                className="planner-start-meeting-btn"
                                onClick={() => void handleStartMeeting(item)}
                              >
                                开始会议
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {view === 'calendar' && (
                <div className="planner-calendar-view">
                  {calendarGroups.length === 0 && <div className="planner-empty">暂无日历项</div>}
                  {calendarGroups.map(([date, group]) => (
                    <div key={date} className="planner-calendar-day">
                      <h4>{date}</h4>
                      {group.map(renderItemRow)}
                    </div>
                  ))}
                </div>
              )}

              {view === 'flow' && (
                <div className="planner-flow-view">
                  {flowItems.length === 0 && <div className="planner-empty">暂无可展示流程</div>}
                  {flowItems.map((item, index) => {
                    const marker = item.start_at || item.due_at || item.created_at;
                    const statusLabel = STATUS_OPTIONS.find((s) => s.value === item.status)?.label ?? item.status;
                    const priorityLabel = PRIORITY_OPTIONS.find((p) => p.value === item.priority)?.label ?? item.priority;
                    return (
                      <div key={item.id} className={`planner-flow-node ${getReminderState(item)}`}>
                        <div className="planner-flow-lane">
                          <div className="planner-flow-step-dot">{index + 1}</div>
                        </div>
                        <div className="planner-flow-node-time">
                          <div className="planner-flow-time-label">时间</div>
                          <div>{marker ? new Date(marker).toLocaleString() : '未设置时间'}</div>
                        </div>
                        <div className="planner-flow-node-body">
                          <div className="planner-flow-head">
                            <div className="planner-item-title">{item.title}</div>
                            <span className={`planner-flow-status-badge status-${item.status}`}>{statusLabel}</span>
                          </div>
                          <div className="planner-item-meta">
                            <span>优先级 {priorityLabel}</span>
                            {item.owner && <span>负责人 {item.owner}</span>}
                            {item.due_at && <span>截止 {new Date(item.due_at).toLocaleString()}</span>}
                            {item.item_type === 'meeting' && item.meeting_platform && <span>平台 {item.meeting_platform}</span>}
                          </div>
                          {selectedPlan?.plan_type === 'meeting' && (
                            <div className="planner-item-actions" style={{ marginTop: 8 }}>
                              <button
                                type="button"
                                className="planner-start-meeting-btn"
                                onClick={() => void handleStartMeeting(item)}
                              >
                                开始会议
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="planner-empty">请先创建计划</div>
          )}
        </section>
      </div>
    </div>
  );
}
