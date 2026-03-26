import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../utils/api';
import { showToast } from './Toast';
import type { MeetingParticipant, MeetingPeer, MeetingRoom, MeetingSignal } from '../types';

declare global {
  interface Window {
    __meetingMediaStreams?: Set<MediaStream>;
  }
}

interface MeetingRoomPanelProps {
  room: MeetingRoom;
  token: string;
  onBack: () => void;
  onEnd: () => void;
}

type BeautyPreset = 'natural' | 'standard' | 'pro';

interface BeautyTuning {
  faceSlim: number;
  eyeEnlarge: number;
  skinSmooth: number;
}

interface FaceAnchor {
  cx: number;
  cy: number;
  width: number;
  height: number;
  leftEye: { x: number; y: number };
  rightEye: { x: number; y: number };
}

const BEAUTY_STORAGE_KEY = 'meeting_beauty_v1';
const SIGNAL_ROOM_KEY_STORAGE_KEY = 'meeting_signal_room_key';

const BEAUTY_PRESET_TUNING: Record<BeautyPreset, BeautyTuning> = {
  natural: { faceSlim: 22, eyeEnlarge: 18, skinSmooth: 28 },
  standard: { faceSlim: 38, eyeEnlarge: 30, skinSmooth: 44 },
  pro: { faceSlim: 56, eyeEnlarge: 45, skinSmooth: 60 },
};

const BEAUTY_PRESET_CONFIG: Record<BeautyPreset, {
  blurRadius: number;
  smoothAlpha: number;
  softLightAlpha: number;
  warmAlpha: number;
  whiteningAlpha: number;
  structureAlpha: number;
  brightness: number;
  contrast: number;
  saturate: number;
}> = {
  natural: {
    blurRadius: 1.2,
    smoothAlpha: 0.08,
    softLightAlpha: 0.07,
    warmAlpha: 0.006,
    whiteningAlpha: 0.02,
    structureAlpha: 0.1,
    brightness: 1.02,
    contrast: 1.02,
    saturate: 1.01,
  },
  standard: {
    blurRadius: 1.9,
    smoothAlpha: 0.13,
    softLightAlpha: 0.1,
    warmAlpha: 0.012,
    whiteningAlpha: 0.03,
    structureAlpha: 0.13,
    brightness: 1.035,
    contrast: 1.035,
    saturate: 1.02,
  },
  pro: {
    blurRadius: 2.8,
    smoothAlpha: 0.17,
    softLightAlpha: 0.13,
    warmAlpha: 0.015,
    whiteningAlpha: 0.04,
    structureAlpha: 0.16,
    brightness: 1.045,
    contrast: 1.045,
    saturate: 1.025,
  },
};

const BEAUTY_PRESET_LABEL: Record<BeautyPreset, string> = {
  natural: '自然',
  standard: '标准',
  pro: '精致',
};

export function MeetingRoomPanel({ room, token, onBack, onEnd }: MeetingRoomPanelProps) {
  const [currentRoom, setCurrentRoom] = useState<MeetingRoom>(room);
  const [participants, setParticipants] = useState<MeetingParticipant[]>([]);
  const [meetingPeers, setMeetingPeers] = useState<MeetingPeer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [peerConnStates, setPeerConnStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [rtcSyncState, setRtcSyncState] = useState<'syncing' | 'ok' | 'retrying'>('syncing');
  const [focusedTileId, setFocusedTileId] = useState<string | null>(null);
  const [remoteAudioLevels, setRemoteAudioLevels] = useState<Record<string, number>>({});
  const [activeSpeakerPeerId, setActiveSpeakerPeerId] = useState<string | null>(null);
  const [localAudioLevel, setLocalAudioLevel] = useState(0);
  const [localSpeaking, setLocalSpeaking] = useState(false);
  const [userName, setUserName] = useState('本地用户');
  const [clockTick, setClockTick] = useState(0);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [cameraSwitching, setCameraSwitching] = useState(false);
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [signalServerUrl, setSignalServerUrl] = useState('');
  const [signalRoomKey, setSignalRoomKey] = useState(room.room_code || String(room.id));
  const [beautyTabOpen, setBeautyTabOpen] = useState(false);
  const [beautyPreset, setBeautyPreset] = useState<BeautyPreset | null>('standard');
  const [beautyTuning, setBeautyTuning] = useState<BeautyTuning>(BEAUTY_PRESET_TUNING.standard);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [displayStream, setDisplayStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const beautyTabRef = useRef<HTMLDivElement | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const acquiredStreamsRef = useRef<Set<MediaStream>>(new Set());
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const micRequestSeqRef = useRef<number>(0);
  const cameraRequestSeqRef = useRef<number>(0);
  const cameraToggleSeqRef = useRef<number>(0);
  const micEnabledRef = useRef(true);
  const cameraEnabledRef = useRef(true);
  const localPeerIdRef = useRef<string>(`peer-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`);
  const pcMapRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pendingIceRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  const lastSignalIdRef = useRef<number>(0);
  const rtcLoopBusyRef = useRef(false);
  const rtcLoopTimerRef = useRef<number | null>(null);
  const rtcErrorStreakRef = useRef(0);
  const speakerStateRef = useRef<{
    smoothed: Record<string, number>;
    activePeerId: string | null;
    holdUntil: number;
  }>({
    smoothed: {},
    activePeerId: null,
    holdUntil: 0,
  });
  const audioCtxRef = useRef<AudioContext | null>(null);
  const localAudioAnalyserRef = useRef<{ analyser: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array } | null>(null);
  const localAudioSmoothedRef = useRef(0);
  const remoteAudioAnalyserRef = useRef<Map<string, { analyser: AnalyserNode; source: MediaStreamAudioSourceNode; data: Uint8Array }>>(new Map());
  const faceDetectorRef = useRef<any>(null);
  const faceDetectionPendingRef = useRef(false);
  const faceAnchorRef = useRef<FaceAnchor | null>(null);
  const faceAnchorLastSeenAtRef = useRef<number>(0);
  const detectionFrameRef = useRef(0);
  const perfAvgMsRef = useRef(16);
  const perfLevelRef = useRef(0);
  const lastFrameTimeRef = useRef(performance.now());

  useEffect(() => {
    micEnabledRef.current = micEnabled;
    cameraEnabledRef.current = cameraEnabled;
  }, [micEnabled, cameraEnabled]);

  const getGlobalMediaBag = (): Set<MediaStream> => {
    if (!window.__meetingMediaStreams) {
      window.__meetingMediaStreams = new Set<MediaStream>();
    }
    return window.__meetingMediaStreams;
  };

  const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

  const getActiveBeautyPreset = (): BeautyPreset => beautyPreset ?? 'standard';

  const getAdaptiveBeautyConfig = (preset: BeautyPreset, skinSmooth: number, perfLevel: number) => {
    const base = BEAUTY_PRESET_CONFIG[preset];
    const smoothScale = clamp(skinSmooth / 50, 0, 2);
    const perfScale = perfLevel === 2 ? 0.7 : perfLevel === 1 ? 0.84 : 1;
    return {
      blurRadius: base.blurRadius * smoothScale * perfScale,
      smoothAlpha: clamp(base.smoothAlpha * smoothScale * perfScale, 0, 0.32),
      softLightAlpha: base.softLightAlpha * perfScale,
      warmAlpha: base.warmAlpha,
      whiteningAlpha: base.whiteningAlpha * perfScale,
      structureAlpha: base.structureAlpha,
      brightness: base.brightness + Math.max(0, skinSmooth - 50) * 0.0005,
      contrast: base.contrast,
      saturate: base.saturate,
    };
  };

  const getFallbackFaceAnchor = (width: number, height: number): FaceAnchor => {
    const faceWidth = width * 0.42;
    const faceHeight = height * 0.56;
    const cx = width * 0.5;
    const cy = height * 0.48;
    const eyeOffsetX = faceWidth * 0.2;
    const eyeOffsetY = faceHeight * 0.17;
    return {
      cx,
      cy,
      width: faceWidth,
      height: faceHeight,
      leftEye: { x: cx - eyeOffsetX, y: cy - eyeOffsetY },
      rightEye: { x: cx + eyeOffsetX, y: cy - eyeOffsetY },
    };
  };

  const clampRectToCanvas = (
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    canvasW: number,
    canvasH: number
  ) => {
    const minW = 4;
    const minH = 4;
    const maxSX = Math.max(0, canvasW - minW);
    const maxSY = Math.max(0, canvasH - minH);
    const nx = clamp(sx, 0, maxSX);
    const ny = clamp(sy, 0, maxSY);
    const nw = clamp(sw, minW, canvasW - nx);
    const nh = clamp(sh, minH, canvasH - ny);
    return {
      sx: Math.round(nx),
      sy: Math.round(ny),
      sw: Math.round(nw),
      sh: Math.round(nh),
    };
  };

  const smoothFaceAnchor = (next: FaceAnchor): FaceAnchor => {
    const prev = faceAnchorRef.current;
    if (!prev) return next;
    const alpha = 0.26;
    return {
      cx: prev.cx + (next.cx - prev.cx) * alpha,
      cy: prev.cy + (next.cy - prev.cy) * alpha,
      width: prev.width + (next.width - prev.width) * alpha,
      height: prev.height + (next.height - prev.height) * alpha,
      leftEye: {
        x: prev.leftEye.x + (next.leftEye.x - prev.leftEye.x) * alpha,
        y: prev.leftEye.y + (next.leftEye.y - prev.leftEye.y) * alpha,
      },
      rightEye: {
        x: prev.rightEye.x + (next.rightEye.x - prev.rightEye.x) * alpha,
        y: prev.rightEye.y + (next.rightEye.y - prev.rightEye.y) * alpha,
      },
    };
  };

  const extractFaceAnchor = (rawFace: any, width: number, height: number): FaceAnchor | null => {
    if (!rawFace?.boundingBox) return null;
    const box = rawFace.boundingBox;
    const x = Number(box.x ?? box.left ?? 0);
    const y = Number(box.y ?? box.top ?? 0);
    const w = Number(box.width ?? 0);
    const h = Number(box.height ?? 0);
    if (w <= 0 || h <= 0) return null;
    const anchor: FaceAnchor = {
      cx: x + w / 2,
      cy: y + h / 2,
      width: w,
      height: h,
      leftEye: { x: x + w * 0.33, y: y + h * 0.4 },
      rightEye: { x: x + w * 0.67, y: y + h * 0.4 },
    };
    const landmarks = Array.isArray(rawFace.landmarks) ? rawFace.landmarks : [];
    const left = landmarks.find((item: any) => String(item.type || '').toLowerCase().includes('left') && String(item.type || '').toLowerCase().includes('eye'));
    const right = landmarks.find((item: any) => String(item.type || '').toLowerCase().includes('right') && String(item.type || '').toLowerCase().includes('eye'));
    if (left && typeof left.x === 'number' && typeof left.y === 'number') {
      anchor.leftEye = { x: left.x, y: left.y };
    }
    if (right && typeof right.x === 'number' && typeof right.y === 'number') {
      anchor.rightEye = { x: right.x, y: right.y };
    }
    anchor.cx = clamp(anchor.cx, width * 0.2, width * 0.8);
    anchor.cy = clamp(anchor.cy, height * 0.2, height * 0.8);
    anchor.width = clamp(anchor.width, width * 0.2, width * 0.8);
    anchor.height = clamp(anchor.height, height * 0.25, height * 0.9);
    return anchor;
  };

  const applyBeautyPreset = (preset: BeautyPreset) => {
    setBeautyPreset(preset);
    setBeautyTuning(BEAUTY_PRESET_TUNING[preset]);
  };

  const requestTileFullscreen = (target: EventTarget | null) => {
    const el = target as HTMLElement | null;
    if (!el) return;
    const fullscreenEl = el.closest('.meeting-video-tile') as any;
    if (!fullscreenEl) return;
    if (typeof fullscreenEl.requestFullscreen === 'function') {
      void fullscreenEl.requestFullscreen().catch(() => undefined);
      return;
    }
    if (typeof fullscreenEl.webkitRequestFullscreen === 'function') {
      fullscreenEl.webkitRequestFullscreen();
    }
  };

  const ensureAudioContext = () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const Ctor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext | undefined;
    if (!Ctor) return null;
    audioCtxRef.current = new Ctor();
    return audioCtxRef.current;
  };
  const signalingRemoteEnabled = Boolean(signalServerUrl.trim());
  const signalingRoomIdOrKey: number | string = signalingRemoteEnabled
    ? (signalRoomKey.trim() || currentRoom.room_code || String(currentRoom.id))
    : currentRoom.id;

  const saveSignalConfig = () => {
    const normalized = api.setMeetingSignalServerUrl(signalServerUrl);
    setSignalServerUrl(normalized);
    const normalizedRoomKey = signalRoomKey.trim() || currentRoom.room_code || String(currentRoom.id);
    setSignalRoomKey(normalizedRoomKey);
    localStorage.setItem(SIGNAL_ROOM_KEY_STORAGE_KEY, normalizedRoomKey);
    showToast(normalized ? '已切换到远程信令模式' : '已切换到本地信令模式', 'success');
  };

  const clearSignalConfig = () => {
    api.setMeetingSignalServerUrl('');
    setSignalServerUrl('');
    const fallback = currentRoom.room_code || String(currentRoom.id);
    setSignalRoomKey(fallback);
    localStorage.setItem(SIGNAL_ROOM_KEY_STORAGE_KEY, fallback);
    showToast('已恢复本地信令模式', 'info');
  };

  const copyInviteInfo = async () => {
    const roomKey = signalRoomKey.trim() || currentRoom.room_code || String(currentRoom.id);
    const signalUrl = signalServerUrl.trim();
    if (!signalUrl) {
      showToast('请先填写并保存远程信令服务地址', 'error');
      return;
    }
    const inviteText = [
      `会议名称：${currentRoom.room_name}`,
      `会议房间码：${currentRoom.room_code}`,
      `信令服务：${signalUrl}`,
      `房间标识：${roomKey}`,
      '使用方式：在会议页右侧“远程信令”填写以上服务地址和房间标识后保存。',
    ].join('\n');
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(inviteText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = inviteText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      showToast('邀请信息已复制', 'success');
    } catch (error) {
      console.error('Failed to copy invite info:', error);
      showToast('复制失败，请手动复制', 'error');
    }
  };

  const publishSignal = async (
    toPeerId: string,
    signalType: MeetingSignal['signal_type'],
    payload: unknown
  ) => {
    await api.publishMeetingSignal(
      signalingRoomIdOrKey,
      localPeerIdRef.current,
      toPeerId,
      signalType,
      JSON.stringify(payload),
    );
  };

  const getLocalLiveTracks = () => {
    const tracks: MediaStreamTrack[] = [];
    const audioTrack = micStreamRef.current?.getAudioTracks().find((track) => track.readyState === 'live');
    if (audioTrack) tracks.push(audioTrack);
    const videoTrack = cameraStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live');
    if (videoTrack) tracks.push(videoTrack);
    return tracks;
  };

  const closePeerConnection = (peerId: string) => {
    const pc = pcMapRef.current.get(peerId);
    if (!pc) return;
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    } catch (error) {
      console.warn('Failed to close peer connection:', error);
    }
    pcMapRef.current.delete(peerId);
    pendingIceRef.current.delete(peerId);
    setPeerConnStates((prev) => {
      if (!prev[peerId]) return prev;
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setRemoteStreams((prev) => {
      if (!prev[peerId]) return prev;
      const next = { ...prev };
      delete next[peerId];
      remoteStreamsRef.current = next;
      return next;
    });
  };

  const syncPeerSenders = (pc: RTCPeerConnection) => {
    const desiredTracks = getLocalLiveTracks();
    const senders = pc.getSenders();
    const senderByKind = new Map<string, RTCRtpSender>();
    senders.forEach((sender) => {
      if (sender.track) senderByKind.set(sender.track.kind, sender);
    });

    desiredTracks.forEach((track) => {
      const sender = senderByKind.get(track.kind);
      if (sender) {
        if (sender.track?.id !== track.id) {
          void sender.replaceTrack(track).catch((error) => {
            console.warn('Failed to replace sender track:', error);
          });
        }
      } else {
        const stream = track.kind === 'audio' ? micStreamRef.current : cameraStreamRef.current;
        if (stream) {
          pc.addTrack(track, stream);
        }
      }
    });

    senders.forEach((sender) => {
      const kind = sender.track?.kind;
      if (!kind) return;
      if (!desiredTracks.some((track) => track.kind === kind)) {
        void sender.replaceTrack(null).catch((error) => {
          console.warn('Failed to clear sender track:', error);
        });
      }
    });
  };

  const ensurePeerConnection = (remotePeerId: string) => {
    const existing = pcMapRef.current.get(remotePeerId);
    if (existing) {
      syncPeerSenders(existing);
      return existing;
    }
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    setPeerConnStates((prev) => ({ ...prev, [remotePeerId]: 'new' }));
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      void publishSignal(remotePeerId, 'ice', event.candidate.toJSON()).catch((error) => {
        console.warn('Failed to publish ICE candidate:', error);
      });
    };
    pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      setRemoteStreams((prev) => {
        const next = { ...prev, [remotePeerId]: stream };
        remoteStreamsRef.current = next;
        return next;
      });
    };
    pc.onconnectionstatechange = () => {
      setPeerConnStates((prev) => ({ ...prev, [remotePeerId]: pc.connectionState }));
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        closePeerConnection(remotePeerId);
      }
    };
    pcMapRef.current.set(remotePeerId, pc);
    syncPeerSenders(pc);
    return pc;
  };

  const maybeCreateOffer = async (remotePeerId: string) => {
    const localId = localPeerIdRef.current;
    if (localId >= remotePeerId) return;
    const pc = ensurePeerConnection(remotePeerId);
    if (pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);
    await publishSignal(remotePeerId, 'offer', offer);
  };

  const handleSignal = async (signal: MeetingSignal) => {
    const remotePeerId = signal.from_peer_id;
    const pc = ensurePeerConnection(remotePeerId);
    let payload: any = null;
    try {
      payload = JSON.parse(signal.payload);
    } catch {
      return;
    }

    if (signal.signal_type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(payload));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await publishSignal(remotePeerId, 'answer', answer);
      const pending = pendingIceRef.current.get(remotePeerId) ?? [];
      pendingIceRef.current.delete(remotePeerId);
      for (const candidate of pending) {
        await pc.addIceCandidate(candidate).catch(() => undefined);
      }
      return;
    }

    if (signal.signal_type === 'answer') {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(payload));
        const pending = pendingIceRef.current.get(remotePeerId) ?? [];
        pendingIceRef.current.delete(remotePeerId);
        for (const candidate of pending) {
          await pc.addIceCandidate(candidate).catch(() => undefined);
        }
      }
      return;
    }

    if (signal.signal_type === 'ice') {
      if (!pc.remoteDescription) {
        const list = pendingIceRef.current.get(remotePeerId) ?? [];
        list.push(payload);
        pendingIceRef.current.set(remotePeerId, list);
        return;
      }
      await pc.addIceCandidate(payload).catch(() => undefined);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem('meeting_user_name');
    if (saved?.trim()) {
      setUserName(saved.trim());
    }
  }, []);

  useEffect(() => {
    if (!userName.trim()) return;
    localStorage.setItem('meeting_user_name', userName.trim());
  }, [userName]);

  useEffect(() => {
    const savedSignalServer = api.getMeetingSignalServerUrl();
    if (savedSignalServer) {
      setSignalServerUrl(savedSignalServer);
    }
    const savedRoomKey = localStorage.getItem(SIGNAL_ROOM_KEY_STORAGE_KEY)?.trim();
    if (savedRoomKey) {
      setSignalRoomKey(savedRoomKey);
    } else {
      setSignalRoomKey(room.room_code || String(room.id));
    }
  }, [room.room_code, room.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(BEAUTY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { preset?: BeautyPreset | null; tuning?: BeautyTuning };
      if (parsed.preset === 'natural' || parsed.preset === 'standard' || parsed.preset === 'pro' || parsed.preset === null) {
        setBeautyPreset(parsed.preset);
      }
      if (parsed.tuning) {
        setBeautyTuning({
          faceSlim: clamp(Number(parsed.tuning.faceSlim ?? 0), 0, 100),
          eyeEnlarge: clamp(Number(parsed.tuning.eyeEnlarge ?? 0), 0, 100),
          skinSmooth: clamp(Number(parsed.tuning.skinSmooth ?? 0), 0, 100),
        });
      }
    } catch (error) {
      console.warn('Failed to restore beauty settings:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem(BEAUTY_STORAGE_KEY, JSON.stringify({
      preset: beautyPreset,
      tuning: beautyTuning,
    }));
  }, [beautyPreset, beautyTuning]);

  useEffect(() => {
    const FaceDetectorCtor = (window as any).FaceDetector;
    if (!FaceDetectorCtor) return;
    try {
      faceDetectorRef.current = new FaceDetectorCtor({
        fastMode: true,
        maxDetectedFaces: 1,
      });
    } catch (error) {
      console.warn('FaceDetector is unavailable, fallback to heuristic anchor:', error);
      faceDetectorRef.current = null;
    }
    return () => {
      faceDetectorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!currentRoom.id || !userName.trim()) return;

    let disposed = false;
    const join = async () => {
      try {
        const online = await api.joinMeetingRoom(currentRoom.id, userName.trim());
        if (!disposed) {
          setParticipants(online);
        }
      } catch (error) {
        console.error('Failed to join meeting room:', error);
        if (!disposed) {
          showToast('加入会议失败', 'error');
        }
      }
    };

    const refresh = async () => {
      try {
        const [nextRoom, online] = await Promise.all([
          api.getMeetingRoom(currentRoom.id),
          api.listMeetingParticipants(currentRoom.id),
        ]);
        if (!disposed) {
          setCurrentRoom(nextRoom);
          setParticipants(online);
        }
      } catch (error) {
        console.error('Failed to refresh meeting state:', error);
      }
    };

    void join();
    const timer = window.setInterval(() => {
      void refresh();
    }, 3000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      void api.leaveMeetingRoom(currentRoom.id, userName.trim()).catch((error) => {
        console.error('Failed to leave meeting room:', error);
      });
    };
  }, [currentRoom.id, userName]);

  useEffect(() => {
    if (!currentRoom.id || !userName.trim()) return;
    let disposed = false;
    const scheduleNext = (delayMs: number) => {
      if (disposed) return;
      if (rtcLoopTimerRef.current) {
        window.clearTimeout(rtcLoopTimerRef.current);
      }
      rtcLoopTimerRef.current = window.setTimeout(() => {
        void tick();
      }, delayMs);
    };

    const tick = async () => {
      if (disposed) return;
      if (rtcLoopBusyRef.current) {
        scheduleNext(260);
        return;
      }
      rtcLoopBusyRef.current = true;
      let nextDelay = 850;
      try {
        if (!disposed) {
          setRtcSyncState((prev) => (prev === 'syncing' ? prev : 'syncing'));
        }
        await api.upsertMeetingPeer(
          signalingRoomIdOrKey,
          localPeerIdRef.current,
          userName.trim(),
          micEnabledRef.current,
          cameraEnabledRef.current
        );
        const peers = await api.listMeetingPeers(signalingRoomIdOrKey);
        if (!disposed) {
          setMeetingPeers(peers);
        }

        const remotePeerIds = new Set(
          peers
            .filter((peer) => peer.peer_id !== localPeerIdRef.current)
            .map((peer) => peer.peer_id)
        );

        for (const [peerId] of pcMapRef.current) {
          if (!remotePeerIds.has(peerId)) {
            closePeerConnection(peerId);
          }
        }

        for (const peerId of remotePeerIds) {
          const pc = ensurePeerConnection(peerId);
          await maybeCreateOffer(peerId);
          if (
            (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') &&
            localPeerIdRef.current < peerId &&
            pc.signalingState === 'stable'
          ) {
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            await publishSignal(peerId, 'offer', offer);
          }
        }

        const signals = await api.pullMeetingSignals(
          signalingRoomIdOrKey,
          localPeerIdRef.current,
          lastSignalIdRef.current
        );
        for (const signal of signals) {
          lastSignalIdRef.current = Math.max(lastSignalIdRef.current, signal.id);
          await handleSignal(signal);
        }
        rtcErrorStreakRef.current = 0;
        if (!disposed) {
          setRtcSyncState('ok');
        }
        nextDelay = signals.length > 0 ? 180 : (remotePeerIds.size > 0 ? 360 : 820);
      } catch (error) {
        console.warn('RTC signaling loop error:', error);
        rtcErrorStreakRef.current += 1;
        if (!disposed) {
          setRtcSyncState('retrying');
        }
        nextDelay = Math.min(2400, 450 + rtcErrorStreakRef.current * 260);
      } finally {
        rtcLoopBusyRef.current = false;
        scheduleNext(nextDelay);
      }
    };

    void tick();

    return () => {
      disposed = true;
      if (rtcLoopTimerRef.current) {
        window.clearTimeout(rtcLoopTimerRef.current);
        rtcLoopTimerRef.current = null;
      }
      void api.leaveMeetingPeer(signalingRoomIdOrKey, localPeerIdRef.current).catch(() => undefined);
      for (const [peerId] of pcMapRef.current) {
        closePeerConnection(peerId);
      }
      setMeetingPeers([]);
      setRemoteStreams({});
      remoteStreamsRef.current = {};
      setPeerConnStates({});
      setRtcSyncState('syncing');
      setRemoteAudioLevels({});
      setActiveSpeakerPeerId(null);
      setLocalAudioLevel(0);
      setLocalSpeaking(false);
      localAudioSmoothedRef.current = 0;
      if (localAudioAnalyserRef.current) {
        try {
          localAudioAnalyserRef.current.source.disconnect();
        } catch {
          // ignore
        }
      }
      localAudioAnalyserRef.current = null;
      speakerStateRef.current = {
        smoothed: {},
        activePeerId: null,
        holdUntil: 0,
      };
      for (const [, entry] of remoteAudioAnalyserRef.current.entries()) {
        try {
          entry.source.disconnect();
        } catch {
          // ignore
        }
      }
      remoteAudioAnalyserRef.current.clear();
      if (audioCtxRef.current) {
        void audioCtxRef.current.close().catch(() => undefined);
        audioCtxRef.current = null;
      }
      lastSignalIdRef.current = 0;
      rtcErrorStreakRef.current = 0;
    };
  }, [currentRoom.id, userName, signalingRoomIdOrKey]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockTick((v) => v + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const elapsedLabel = useMemo(() => {
    if (!currentRoom.started_at) return '00:00';
    const startAt = new Date(currentRoom.started_at).getTime();
    if (Number.isNaN(startAt)) return '00:00';
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startAt) / 1000));
    const mins = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
    const secs = (elapsedSeconds % 60).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  }, [currentRoom.started_at, clockTick]);

  const remotePeerTiles = useMemo(
    () => meetingPeers.filter((peer) => peer.peer_id !== localPeerIdRef.current),
    [meetingPeers]
  );
  const localDisplayName = (userName.trim() || '我').slice(0, 1).toUpperCase();
  const hasFocusedTile = Boolean(focusedTileId);

  useEffect(() => {
    if (!focusedTileId) return;
    if (focusedTileId === 'local') return;
    const exists = remotePeerTiles.some((peer) => `peer:${peer.peer_id}` === focusedTileId);
    if (!exists) {
      setFocusedTileId(null);
    }
  }, [focusedTileId, remotePeerTiles]);

  const stopStreamTracks = (stream: MediaStream | null) => {
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
  };

  const stopAndForgetStream = (stream: MediaStream | null) => {
    if (!stream) return;
    stopStreamTracks(stream);
    acquiredStreamsRef.current.delete(stream);
    getGlobalMediaBag().delete(stream);
  };

  const releaseAllMediaNow = (options?: { skipState?: boolean }) => {
    micRequestSeqRef.current += 1;
    cameraRequestSeqRef.current += 1;
    acquiredStreamsRef.current.forEach((stream) => {
      stopStreamTracks(stream);
    });
    acquiredStreamsRef.current.clear();
    getGlobalMediaBag().forEach((stream) => {
      stopStreamTracks(stream);
    });
    getGlobalMediaBag().clear();
    stopAndForgetStream(micStreamRef.current);
    micStreamRef.current = null;
    stopAndForgetStream(cameraStreamRef.current);
    cameraStreamRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    displayStreamRef.current = null;
    if (!options?.skipState) {
      setDisplayStream(null);
      setScreenSharing(false);
      setLocalStream(null);
    }
    if (localVideoRef.current) {
      localVideoRef.current.pause();
      localVideoRef.current.srcObject = null;
    }
    document.querySelectorAll('video').forEach((videoEl) => {
      const source = videoEl.srcObject;
      if (source instanceof MediaStream) {
        source.getTracks().forEach((track) => {
          track.enabled = false;
          track.stop();
        });
        videoEl.pause();
        videoEl.srcObject = null;
      }
    });
  };

  const forceStopAllVideoTracks = () => {
    acquiredStreamsRef.current.forEach((stream) => {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
    });
    getGlobalMediaBag().forEach((stream) => {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
    });
    const bound = localVideoRef.current?.srcObject;
    if (bound instanceof MediaStream) {
      bound.getVideoTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
    }
  };

  const hardStopCameraTracks = () => {
    console.log('Stopping all camera tracks...');
    // 停止引用的当前流
    cameraStreamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = false;
      track.stop();
    });
    // 停止视频元素绑定的流（如果有的话）
    const bound = localVideoRef.current?.srcObject;
    if (bound instanceof MediaStream) {
      bound.getVideoTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
      localVideoRef.current!.srcObject = null;
    }
    // 停止所有已获取流中的视频轨道，确保彻底关闭摄像头
    acquiredStreamsRef.current.forEach((stream) => {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
    });
    // 同时也检查全局存储的流，有些可能没在当前页面的 ref 里
    getGlobalMediaBag().forEach((stream) => {
      stream.getVideoTracks().forEach((track) => {
        track.enabled = false;
        track.stop();
      });
    });
    // 强制清理所有 video 标签，防止有隐藏或残留的标签在占用
    document.querySelectorAll('video').forEach((v) => {
      if (v.srcObject instanceof MediaStream) {
        v.srcObject.getVideoTracks().forEach(t => {
          t.enabled = false;
          t.stop();
        });
        v.srcObject = null;
        v.pause();
      }
    });
  };

  const ensureMicState = async (enabled: boolean) => {
    const requestSeq = ++micRequestSeqRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持音视频设备');
    }
    if (!enabled) {
      stopAndForgetStream(micStreamRef.current);
      micStreamRef.current = null;
      if (requestSeq === micRequestSeqRef.current) {
        setMediaError(null);
      }
      return null;
    }

    const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    acquiredStreamsRef.current.add(nextStream);
    getGlobalMediaBag().add(nextStream);
    if (requestSeq !== micRequestSeqRef.current) {
      stopAndForgetStream(nextStream);
      return null;
    }
    stopAndForgetStream(micStreamRef.current);
    micStreamRef.current = nextStream;
    setMediaError(null);
    return nextStream;
  };

  const ensureCameraState = async (enabled: boolean) => {
    const requestSeq = ++cameraRequestSeqRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前环境不支持音视频设备');
    }
    if (!enabled) {
      hardStopCameraTracks();
      stopAndForgetStream(cameraStreamRef.current);
      cameraStreamRef.current = null;
      if (requestSeq === cameraRequestSeqRef.current) {
        setLocalStream(null);
        setMediaError(null);
      }
      return null;
    }

    const nextStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
    acquiredStreamsRef.current.add(nextStream);
    getGlobalMediaBag().add(nextStream);
    if (requestSeq !== cameraRequestSeqRef.current) {
      stopAndForgetStream(nextStream);
      return null;
    }
    stopAndForgetStream(cameraStreamRef.current);
    cameraStreamRef.current = nextStream;
    setLocalStream(nextStream);
    setMediaError(null);
    return nextStream;
  };

  const refreshMeetingState = async () => {
    setRefreshing(true);
    try {
      const [nextRoom, online] = await Promise.all([
        api.getMeetingRoom(currentRoom.id),
        api.listMeetingParticipants(currentRoom.id),
      ]);
      setCurrentRoom(nextRoom);
      setParticipants(online);
    } catch (error) {
      console.error('Failed to refresh meeting state:', error);
      showToast('刷新会议状态失败', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void Promise.allSettled([
      ensureMicState(true),
      ensureCameraState(true),
    ]).then((results) => {
      const rejected = results.find((item) => item.status === 'rejected');
      if (rejected?.status === 'rejected') {
        console.error('Failed to init local media:', rejected.reason);
        setMediaError('无法访问麦克风/摄像头，请检查系统权限');
      }
    });
    return () => {
      releaseAllMediaNow({ skipState: true });
    };
  }, []);

  useEffect(() => {
    const targetStream = displayStream ?? localStream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = targetStream ?? null;
      if (targetStream) {
        void localVideoRef.current.play().catch((error) => {
          console.error('Failed to play local preview:', error);
        });
      }
    }
  }, [localStream, displayStream]);

  useEffect(() => {
    for (const [, pc] of pcMapRef.current) {
      syncPeerSenders(pc);
    }
  }, [localStream, micEnabled, cameraEnabled]);

  useEffect(() => {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const activeIds = new Set(Object.keys(remoteStreams));
    for (const [peerId, entry] of remoteAudioAnalyserRef.current.entries()) {
      if (!activeIds.has(peerId)) {
        try {
          entry.source.disconnect();
        } catch {
          // ignore
        }
        remoteAudioAnalyserRef.current.delete(peerId);
      }
    }

    for (const [peerId, stream] of Object.entries(remoteStreams)) {
      if (remoteAudioAnalyserRef.current.has(peerId)) continue;
      const hasAudio = stream.getAudioTracks().some((track) => track.readyState === 'live');
      if (!hasAudio) continue;
      try {
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.76;
        source.connect(analyser);
        remoteAudioAnalyserRef.current.set(peerId, {
          analyser,
          source,
          data: new Uint8Array(analyser.frequencyBinCount),
        });
      } catch (error) {
        console.warn('Failed to create remote audio analyser:', error);
      }
    }
  }, [remoteStreams]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now();
      const next: Record<string, number> = {};
      const prevSmoothed = speakerStateRef.current.smoothed;
      const nextSmoothed: Record<string, number> = {};
      let topPeer: string | null = null;
      let topLevel = 0;

      const ATTACK_ALPHA = 0.44;
      const RELEASE_ALPHA = 0.2;
      const SPEAKER_ON_THRESHOLD = 0.13;
      const SPEAKER_OFF_THRESHOLD = 0.09;
      const SWITCH_DELTA = 0.03;
      const MIN_HOLD_MS = 720;
      const LOCAL_SPEAK_ON_THRESHOLD = 0.14;
      const LOCAL_SPEAK_OFF_THRESHOLD = 0.09;

      for (const [peerId, entry] of remoteAudioAnalyserRef.current.entries()) {
        entry.analyser.getByteFrequencyData(entry.data);
        let sum = 0;
        for (let i = 0; i < entry.data.length; i += 1) {
          sum += entry.data[i];
        }
        const avg = sum / (entry.data.length || 1);
        const instant = clamp(avg / 140, 0, 1);
        const prev = prevSmoothed[peerId] ?? 0;
        const alpha = instant >= prev ? ATTACK_ALPHA : RELEASE_ALPHA;
        const smoothed = prev + (instant - prev) * alpha;
        nextSmoothed[peerId] = smoothed;
        next[peerId] = smoothed;
        if (smoothed > topLevel) {
          topLevel = smoothed;
          topPeer = peerId;
        }
      }

      const ctx = ensureAudioContext();
      if (!micEnabledRef.current) {
        if (localAudioAnalyserRef.current) {
          try {
            localAudioAnalyserRef.current.source.disconnect();
          } catch {
            // ignore
          }
          localAudioAnalyserRef.current = null;
        }
        localAudioSmoothedRef.current = 0;
        setLocalAudioLevel(0);
        setLocalSpeaking(false);
      } else if (ctx) {
        const micStream = micStreamRef.current;
        const hasAudio = Boolean(micStream?.getAudioTracks().some((track) => track.readyState === 'live'));
        if (!hasAudio) {
          if (localAudioAnalyserRef.current) {
            try {
              localAudioAnalyserRef.current.source.disconnect();
            } catch {
              // ignore
            }
            localAudioAnalyserRef.current = null;
          }
          localAudioSmoothedRef.current = 0;
          setLocalAudioLevel(0);
          setLocalSpeaking(false);
        } else {
          if (!localAudioAnalyserRef.current && micStream) {
            try {
              const source = ctx.createMediaStreamSource(micStream);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 256;
              analyser.smoothingTimeConstant = 0.76;
              source.connect(analyser);
              localAudioAnalyserRef.current = {
                analyser,
                source,
                data: new Uint8Array(analyser.frequencyBinCount),
              };
            } catch (error) {
              console.warn('Failed to create local audio analyser:', error);
            }
          }
          if (localAudioAnalyserRef.current) {
            const { analyser, data } = localAudioAnalyserRef.current;
            analyser.getByteFrequencyData(data);
            let sum = 0;
            for (let i = 0; i < data.length; i += 1) {
              sum += data[i];
            }
            const avg = sum / (data.length || 1);
            const instant = clamp(avg / 140, 0, 1);
            const prev = localAudioSmoothedRef.current;
            const alpha = instant >= prev ? ATTACK_ALPHA : RELEASE_ALPHA;
            const smoothed = prev + (instant - prev) * alpha;
            localAudioSmoothedRef.current = smoothed;
            setLocalAudioLevel(smoothed);
            setLocalSpeaking((prevSpeaking) => {
              if (prevSpeaking) {
                return smoothed >= LOCAL_SPEAK_OFF_THRESHOLD;
              }
              return smoothed >= LOCAL_SPEAK_ON_THRESHOLD;
            });
          }
        }
      }

      const currentActive = speakerStateRef.current.activePeerId;
      const currentLevel = currentActive ? (nextSmoothed[currentActive] ?? 0) : 0;
      let nextActive = currentActive;
      let nextHoldUntil = speakerStateRef.current.holdUntil;

      if (topPeer && topLevel >= SPEAKER_ON_THRESHOLD) {
        if (!currentActive) {
          nextActive = topPeer;
          nextHoldUntil = now + MIN_HOLD_MS;
        } else if (topPeer !== currentActive) {
          const canSwitchByGap = topLevel - currentLevel >= SWITCH_DELTA;
          const canSwitchByTime = now >= speakerStateRef.current.holdUntil;
          if (canSwitchByGap && canSwitchByTime) {
            nextActive = topPeer;
            nextHoldUntil = now + MIN_HOLD_MS;
          }
        } else {
          nextHoldUntil = now + MIN_HOLD_MS;
        }
      }

      if (nextActive && (nextSmoothed[nextActive] ?? 0) < SPEAKER_OFF_THRESHOLD && now >= nextHoldUntil) {
        nextActive = null;
        nextHoldUntil = now;
      }

      speakerStateRef.current = {
        smoothed: nextSmoothed,
        activePeerId: nextActive,
        holdUntil: nextHoldUntil,
      };
      setRemoteAudioLevels(next);
      setActiveSpeakerPeerId(nextActive);
    }, 180);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    displayStreamRef.current = displayStream;
  }, [displayStream]);

  useEffect(() => {
    if (cameraEnabled) return;
    forceStopAllVideoTracks();
    const timer = window.setInterval(() => {
      forceStopAllVideoTracks();
    }, 350);
    return () => window.clearInterval(timer);
  }, [cameraEnabled]);

  useEffect(() => {
    let rafId = 0;
    const baseCanvas = document.createElement('canvas');
    const smoothCanvas = document.createElement('canvas');
    const mergedCanvas = document.createElement('canvas');
    const preWarpCanvas = document.createElement('canvas');
    const patchCanvas = document.createElement('canvas');
    const maskCanvas = document.createElement('canvas');

    const drawFrame = () => {
      const video = localVideoRef.current;
      const output = localCanvasRef.current;
      if (!video || !output) {
        rafId = requestAnimationFrame(drawFrame);
        return;
      }

      // 如果没有视频源且没有在共享屏幕，则清空画布并跳过
      if (!localStream && !displayStream) {
        const outCtx = output.getContext('2d');
        outCtx?.clearRect(0, 0, output.width, output.height);
        rafId = requestAnimationFrame(drawFrame);
        return;
      }

      const width = video.videoWidth || 640;
      const height = video.videoHeight || 360;
      if (output.width !== width || output.height !== height) {
        output.width = width;
        output.height = height;
      }
      if (baseCanvas.width !== width || baseCanvas.height !== height) {
        baseCanvas.width = width;
        baseCanvas.height = height;
        smoothCanvas.width = width;
        smoothCanvas.height = height;
        mergedCanvas.width = width;
        mergedCanvas.height = height;
        preWarpCanvas.width = width;
        preWarpCanvas.height = height;
        patchCanvas.width = width;
        patchCanvas.height = height;
        maskCanvas.width = width;
        maskCanvas.height = height;
      }

      const baseCtx = baseCanvas.getContext('2d');
      const smoothCtx = smoothCanvas.getContext('2d');
      const mergedCtx = mergedCanvas.getContext('2d');
      const outCtx = output.getContext('2d');
      const patchCtx = patchCanvas.getContext('2d');
      const maskCtx = maskCanvas.getContext('2d');
      if (!baseCtx || !smoothCtx || !mergedCtx || !outCtx || !patchCtx || !maskCtx) {
        rafId = requestAnimationFrame(drawFrame);
        return;
      }

      const blendWarpPatch = (
        srcCanvas: HTMLCanvasElement,
        sourceRect: { sx: number; sy: number; sw: number; sh: number },
        destRect: { dx: number; dy: number; dw: number; dh: number },
        center: { x: number; y: number },
        radius: number,
        alpha: number
      ) => {
        patchCtx.clearRect(0, 0, width, height);
        patchCtx.drawImage(
          srcCanvas,
          sourceRect.sx,
          sourceRect.sy,
          sourceRect.sw,
          sourceRect.sh,
          destRect.dx,
          destRect.dy,
          destRect.dw,
          destRect.dh
        );

        const featherRadius = Math.max(8, radius);
        const inner = Math.max(2, featherRadius * 0.78);
        maskCtx.clearRect(0, 0, width, height);
        const gradient = maskCtx.createRadialGradient(
          center.x,
          center.y,
          inner,
          center.x,
          center.y,
          featherRadius
        );
        gradient.addColorStop(0, 'rgba(255,255,255,1)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        maskCtx.fillStyle = gradient;
        maskCtx.fillRect(center.x - featherRadius, center.y - featherRadius, featherRadius * 2, featherRadius * 2);

        patchCtx.globalCompositeOperation = 'destination-in';
        patchCtx.drawImage(maskCanvas, 0, 0);
        patchCtx.globalCompositeOperation = 'source-over';

        mergedCtx.globalAlpha = alpha;
        mergedCtx.drawImage(patchCanvas, 0, 0, width, height);
        mergedCtx.globalAlpha = 1;
      };

      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      perfAvgMsRef.current = perfAvgMsRef.current * 0.9 + delta * 0.1;
      if (perfAvgMsRef.current > 40) {
        perfLevelRef.current = 2;
      } else if (perfAvgMsRef.current > 30) {
        perfLevelRef.current = 1;
      } else {
        perfLevelRef.current = 0;
      }

      baseCtx.clearRect(0, 0, width, height);
      baseCtx.drawImage(video, 0, 0, width, height);

      if (!beautyPreset) {
        outCtx.clearRect(0, 0, width, height);
        outCtx.drawImage(baseCanvas, 0, 0, width, height);
        rafId = requestAnimationFrame(drawFrame);
        return;
      }

      detectionFrameRef.current += 1;
      const detectEvery = perfLevelRef.current === 2 ? 14 : perfLevelRef.current === 1 ? 9 : 6;
      if (faceDetectorRef.current && !faceDetectionPendingRef.current && detectionFrameRef.current % detectEvery === 0) {
        faceDetectionPendingRef.current = true;
        void faceDetectorRef.current.detect(video)
          .then((faces: any[]) => {
            const next = extractFaceAnchor(faces?.[0], width, height);
            if (next) {
              faceAnchorRef.current = smoothFaceAnchor(next);
              faceAnchorLastSeenAtRef.current = performance.now();
            }
          })
          .catch(() => {
            // Ignore detector errors and continue fallback mode.
          })
          .finally(() => {
            faceDetectionPendingRef.current = false;
          });
      }
      const hasRecentFace = faceAnchorRef.current && (performance.now() - faceAnchorLastSeenAtRef.current) < 900;
      const detectorAvailable = Boolean(faceDetectorRef.current);
      const faceAnchor = hasRecentFace
        ? faceAnchorRef.current
        : (detectorAvailable ? null : getFallbackFaceAnchor(width, height));

      const activePreset = getActiveBeautyPreset();
      const config = getAdaptiveBeautyConfig(activePreset, beautyTuning.skinSmooth, perfLevelRef.current);
      const faceSlimRatio = clamp((beautyTuning.faceSlim / 100) * (perfLevelRef.current === 2 ? 0.64 : perfLevelRef.current === 1 ? 0.82 : 1), 0, 1);
      const eyeRatio = clamp((beautyTuning.eyeEnlarge / 100) * (perfLevelRef.current === 2 ? 0.68 : perfLevelRef.current === 1 ? 0.86 : 1), 0, 1);

      smoothCtx.clearRect(0, 0, width, height);
      smoothCtx.imageSmoothingEnabled = true;
      smoothCtx.filter = `blur(${config.blurRadius.toFixed(2)}px)`;
      smoothCtx.drawImage(video, 0, 0, width, height);
      smoothCtx.filter = 'none';

      mergedCtx.clearRect(0, 0, width, height);
      mergedCtx.drawImage(baseCanvas, 0, 0, width, height);
      mergedCtx.globalAlpha = config.smoothAlpha;
      mergedCtx.drawImage(smoothCanvas, 0, 0, width, height);
      mergedCtx.globalAlpha = 1;
      mergedCtx.globalCompositeOperation = 'soft-light';
      mergedCtx.globalAlpha = config.softLightAlpha;
      mergedCtx.drawImage(baseCanvas, 0, 0, width, height);
      mergedCtx.globalAlpha = 1;
      mergedCtx.globalCompositeOperation = 'source-over';
      mergedCtx.fillStyle = `rgba(255, 228, 212, ${config.warmAlpha.toFixed(3)})`;
      mergedCtx.fillRect(0, 0, width, height);
      mergedCtx.globalCompositeOperation = 'screen';
      mergedCtx.globalAlpha = config.whiteningAlpha;
      mergedCtx.drawImage(baseCanvas, 0, 0, width, height);
      mergedCtx.globalAlpha = 1;
      mergedCtx.globalCompositeOperation = 'overlay';
      mergedCtx.globalAlpha = config.structureAlpha;
      mergedCtx.drawImage(baseCanvas, 0, 0, width, height);
      mergedCtx.globalAlpha = 1;
      mergedCtx.globalCompositeOperation = 'source-over';
      const preWarpCtx = preWarpCanvas.getContext('2d');
      if (preWarpCtx) {
        preWarpCtx.clearRect(0, 0, width, height);
        preWarpCtx.drawImage(mergedCanvas, 0, 0, width, height);
      }
      let warpApplied = false;

      if (faceAnchor && faceSlimRatio > 0.01) {
        const slimScale = 1 + faceSlimRatio * 0.08;
        const rx = faceAnchor.width * 0.5;
        const ry = faceAnchor.height * 0.54;
        const sourceRect = clampRectToCanvas(
          faceAnchor.cx - (faceAnchor.width * slimScale) / 2,
          faceAnchor.cy - faceAnchor.height * 0.5,
          faceAnchor.width * slimScale,
          faceAnchor.height,
          width,
          height
        );
        blendWarpPatch(
          preWarpCanvas,
          sourceRect,
          {
            dx: faceAnchor.cx - faceAnchor.width / 2,
            dy: faceAnchor.cy - faceAnchor.height * 0.5,
            dw: faceAnchor.width,
            dh: faceAnchor.height,
          },
          { x: faceAnchor.cx, y: faceAnchor.cy },
          Math.max(rx, ry) * 1.08,
          clamp(0.34 + faceSlimRatio * 0.16, 0.34, 0.5)
        );
        warpApplied = true;
      }

      if (faceAnchor && eyeRatio > 0.01) {
        const drawEye = (eye: { x: number; y: number }) => {
          const safeEye = { x: clamp(eye.x, 0, width), y: clamp(eye.y, 0, height) };
          const r = clamp(Math.min(faceAnchor.width, faceAnchor.height) * (0.074 + eyeRatio * 0.03), 7, 26);
          const magnify = 1 + eyeRatio * 0.14;
          const sourceRect = clampRectToCanvas(
            safeEye.x - (r * 2) / magnify / 2,
            safeEye.y - (r * 2) / magnify / 2,
            (r * 2) / magnify,
            (r * 2) / magnify,
            width,
            height
          );
          blendWarpPatch(
            preWarpCanvas,
            sourceRect,
            {
              dx: safeEye.x - r,
              dy: safeEye.y - r,
              dw: r * 2,
              dh: r * 2,
            },
            { x: safeEye.x, y: safeEye.y },
            r * 1.18,
            clamp(0.34 + eyeRatio * 0.18, 0.34, 0.52)
          );
          warpApplied = true;
        };
        drawEye(faceAnchor.leftEye);
        drawEye(faceAnchor.rightEye);
      }

      outCtx.clearRect(0, 0, width, height);
      outCtx.filter = `brightness(${config.brightness.toFixed(3)}) contrast(${config.contrast.toFixed(3)}) saturate(${config.saturate.toFixed(3)})`;
      if (warpApplied && preWarpCtx) {
        const warpBlendAlpha = clamp(0.34 + Math.max(faceSlimRatio, eyeRatio) * 0.22, 0.34, 0.56);
        outCtx.globalAlpha = 1;
        outCtx.drawImage(preWarpCanvas, 0, 0, width, height);
        outCtx.globalAlpha = warpBlendAlpha;
        outCtx.drawImage(mergedCanvas, 0, 0, width, height);
        outCtx.globalAlpha = 1;
      } else {
        outCtx.drawImage(mergedCanvas, 0, 0, width, height);
      }
      outCtx.filter = 'none';

      rafId = requestAnimationFrame(drawFrame);
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [beautyPreset, beautyTuning, localStream, displayStream]);

  useEffect(() => {
    if (!beautyTabOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!beautyTabRef.current) return;
      const target = event.target as Node;
      if (!beautyTabRef.current.contains(target)) {
        setBeautyTabOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [beautyTabOpen]);

  return (
    <div className="meeting-room-panel">
      <div className="meeting-room-header">
        <div>
          <h2>{currentRoom.room_name}</h2>
          <div className="meeting-room-meta">
            <span>房间号 {currentRoom.room_code}</span>
            <span>状态 {currentRoom.state === 'in_progress' ? '进行中' : currentRoom.state === 'ended' ? '已结束' : '待开始'}</span>
            <span>在线 {participants.length} 人</span>
            <span>时长 {elapsedLabel}</span>
            <span>同步 {rtcSyncState === 'ok' ? '正常' : rtcSyncState === 'syncing' ? '同步中' : '重试中'}</span>
            <span>信令 {signalingRemoteEnabled ? '远程' : '本地'}</span>
          </div>
        </div>
        <div className="meeting-room-actions">
          <button
            className="meeting-btn-secondary"
            onClick={() => {
              releaseAllMediaNow();
              onBack();
            }}
          >
            返回计划
          </button>
          <button
            className="meeting-btn-primary"
            onClick={() => {
              releaseAllMediaNow();
              onEnd();
            }}
          >
            结束会议
          </button>
        </div>
      </div>

      <div className="meeting-room-control-bar">
        <button
          className={`meeting-control-btn ${micEnabled ? 'active' : ''}`}
          onClick={async () => {
            const next = !micEnabled;
            setMicEnabled(next);
            await ensureMicState(next).catch((error) => {
              console.error('Failed to toggle microphone:', error);
              showToast('切换麦克风失败，请检查权限', 'error');
              setMicEnabled(micEnabled);
            });
          }}
        >
          {micEnabled ? '麦克风已开' : '麦克风已关'}
        </button>
        <button
          className={`meeting-control-btn ${cameraEnabled ? 'active' : ''}`}
          disabled={cameraSwitching}
          onClick={async () => {
            const next = !cameraEnabled;
            const toggleSeq = ++cameraToggleSeqRef.current;
            setCameraSwitching(true);
            setCameraEnabled(next);

            if (!next) {
              setMicEnabled(false);
              setScreenSharing(false);
              releaseAllMediaNow();
              if (toggleSeq === cameraToggleSeqRef.current) {
                setCameraSwitching(false);
              }
              return;
            }

            try {
              await ensureCameraState(next);
            } catch (error) {
              console.error('Failed to toggle camera:', error);
              showToast('切换摄像头失败，请检查权限', 'error');
              setCameraEnabled(!next);
            } finally {
              if (toggleSeq === cameraToggleSeqRef.current) {
                setCameraSwitching(false);
              }
            }
          }}
        >
          {cameraSwitching ? '切换中...' : (cameraEnabled ? '摄像头已开' : '摄像头已关')}
        </button>
        <button
          className={`meeting-control-btn ${screenSharing ? 'active' : ''}`}
          onClick={async () => {
            if (screenSharing) {
              displayStream?.getTracks().forEach((track) => track.stop());
              setDisplayStream(null);
              setScreenSharing(false);
              showToast('已停止共享屏幕', 'info');
              return;
            }
            try {
              if (!navigator.mediaDevices?.getDisplayMedia) {
                throw new Error('当前环境不支持屏幕共享');
              }
              const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
              const videoTrack = stream.getVideoTracks()[0];
              if (videoTrack) {
                videoTrack.onended = () => {
                  setDisplayStream(null);
                  setScreenSharing(false);
                };
              }
              setDisplayStream(stream);
              setScreenSharing(true);
              showToast('已开启共享屏幕', 'success');
            } catch (error) {
              console.error('Failed to share screen:', error);
              showToast('共享屏幕失败', 'error');
            }
          }}
        >
          {screenSharing ? '停止共享' : '共享屏幕'}
        </button>
        <button className="meeting-control-btn" onClick={() => void refreshMeetingState()} disabled={refreshing}>
          {refreshing ? '刷新中...' : '刷新状态'}
        </button>
        <div ref={beautyTabRef} className={`meeting-beauty-tab ${beautyTabOpen ? 'open' : ''}`}>
          <button
            type="button"
            className={`meeting-control-btn ${beautyPreset ? 'active' : ''}`}
            onClick={() => setBeautyTabOpen((v) => !v)}
          >
            美颜{beautyPreset ? `·${BEAUTY_PRESET_LABEL[beautyPreset]}` : '·关'}
          </button>
          {beautyTabOpen && (
            <div className="meeting-beauty-panel">
              <div className="meeting-beauty-presets-row">
                {(['natural', 'standard', 'pro'] as BeautyPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    className={`meeting-beauty-preset-btn ${beautyPreset === preset ? 'active' : ''}`}
                    onClick={() => {
                      if (beautyPreset === preset) {
                        setBeautyPreset(null);
                        return;
                      }
                      applyBeautyPreset(preset);
                    }}
                  >
                    {BEAUTY_PRESET_LABEL[preset]}
                  </button>
                ))}
                <button
                  type="button"
                  className={`meeting-beauty-preset-btn ${!beautyPreset ? 'active' : ''}`}
                  onClick={() => setBeautyPreset(null)}
                >
                  关闭
                </button>
              </div>
              <div className="meeting-beauty-advanced">
                <label className="meeting-beauty-slider">
                  <span>瘦脸</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={beautyTuning.faceSlim}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setBeautyPreset((prev) => prev ?? 'standard');
                      setBeautyTuning((prev) => ({ ...prev, faceSlim: value }));
                    }}
                  />
                  <em>{beautyTuning.faceSlim}</em>
                </label>
                <label className="meeting-beauty-slider">
                  <span>大眼</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={beautyTuning.eyeEnlarge}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setBeautyPreset((prev) => prev ?? 'standard');
                      setBeautyTuning((prev) => ({ ...prev, eyeEnlarge: value }));
                    }}
                  />
                  <em>{beautyTuning.eyeEnlarge}</em>
                </label>
                <label className="meeting-beauty-slider">
                  <span>磨皮</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={beautyTuning.skinSmooth}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setBeautyPreset((prev) => prev ?? 'standard');
                      setBeautyTuning((prev) => ({ ...prev, skinSmooth: value }));
                    }}
                  />
                  <em>{beautyTuning.skinSmooth}</em>
                </label>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="meeting-room-body">
        <div className="meeting-room-video-grid">
          <div
            className={`meeting-video-tile meeting-video-tile-local meeting-video-tile-interactive ${focusedTileId === 'local' ? 'focused' : ''} ${hasFocusedTile && focusedTileId !== 'local' ? 'dimmed' : ''}`}
            onClick={() => setFocusedTileId((prev) => (prev === 'local' ? null : 'local'))}
            onDoubleClick={(e) => requestTileFullscreen(e.target)}
            title="点击聚焦，双击全屏"
          >
            <video ref={localVideoRef} autoPlay playsInline muted className="meeting-local-video-source" />
            <canvas
              ref={localCanvasRef}
              className={`meeting-local-canvas ${screenSharing ? '' : 'mirrored'}`}
            />
            {!cameraEnabled && !screenSharing && (
              <div className="meeting-local-placeholder">
                <div className="meeting-local-avatar">{localDisplayName}</div>
                <div className="meeting-local-placeholder-text">摄像头已关闭</div>
              </div>
            )}
            <div className="meeting-video-tile-label">
              <span>{userName.trim() || '我'}</span>
              <span>{screenSharing ? '共享中' : '本地画面'}</span>
              <span className="meeting-remote-audio-meter meeting-local-audio-meter">
                <i style={{ width: `${Math.round(localAudioLevel * 100)}%` }} />
              </span>
              {localSpeaking && micEnabled && <span className="meeting-remote-speaking-badge">我在发言</span>}
            </div>
          </div>
          {remotePeerTiles.length === 0 && <div className="meeting-video-tile">暂无其他在线参会人</div>}
          {remotePeerTiles.map((peer) => {
            const stream = remoteStreams[peer.peer_id];
            const connState = peerConnStates[peer.peer_id] ?? 'new';
            const hasVideo = Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled));
            const hasAudio = Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live' && track.enabled));
            const level = remoteAudioLevels[peer.peer_id] ?? 0;
            const isSpeaking = activeSpeakerPeerId === peer.peer_id;
            const tileId = `peer:${peer.peer_id}`;
            const connLabel = connState === 'connected'
              ? '已连接'
              : connState === 'connecting'
                ? '连接中'
                : connState === 'disconnected'
                  ? '已断开'
                  : connState === 'failed'
                    ? '连接失败'
                    : '准备中';
            return (
              <div
                key={peer.peer_id}
                className={`meeting-video-tile meeting-video-tile-remote meeting-video-tile-interactive ${focusedTileId === tileId ? 'focused' : ''} ${hasFocusedTile && focusedTileId !== tileId ? 'dimmed' : ''} ${isSpeaking ? 'speaking' : ''}`}
                onClick={() => setFocusedTileId((prev) => (prev === tileId ? null : tileId))}
                onDoubleClick={(e) => requestTileFullscreen(e.target)}
                title="点击聚焦，双击全屏"
              >
                {stream ? (
                  <video
                    autoPlay
                    playsInline
                    ref={(el) => {
                      if (!el) return;
                      if (el.srcObject !== stream) {
                        el.srcObject = stream;
                      }
                      void el.play().catch(() => undefined);
                    }}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                ) : (
                  <span>{peer.user_name}</span>
                )}
                <div className="meeting-remote-tile-label">
                  <span>{peer.user_name}</span>
                  <span>{connLabel}</span>
                  <span>对方 {peer.camera_on ? '开视频' : '关视频'} / {peer.mic_on ? '开麦' : '关麦'}</span>
                  {stream && <span>流 {hasVideo ? '视频有' : '视频无'} / {hasAudio ? '音频有' : '音频无'}</span>}
                  <span className="meeting-remote-audio-meter">
                    <i style={{ width: `${Math.round(level * 100)}%` }} />
                  </span>
                  {isSpeaking && <span className="meeting-remote-speaking-badge">发言中</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className={`meeting-room-info-float ${infoCollapsed ? 'collapsed' : ''}`}>
          <button
            className="meeting-room-info-toggle"
            onClick={() => setInfoCollapsed((v) => !v)}
          >
            {infoCollapsed ? '展开信息' : '收起信息'}
          </button>
          {!infoCollapsed && (
            <div className="meeting-room-sidebar">
              <h3>会议控制</h3>
              <label className="meeting-room-name-input">
                昵称
                <input value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="输入昵称" />
              </label>
              {mediaError && <p className="meeting-room-media-error">{mediaError}</p>}
              <h3>会议连接信息</h3>
              <p className="meeting-room-token-label">Token（开发态）</p>
              <code className="meeting-room-token">{token}</code>
              <p className="meeting-room-token-label" style={{ marginTop: 8 }}>共享房间码</p>
              <code className="meeting-room-token">{currentRoom.room_code}</code>
              <h3 style={{ marginTop: 12 }}>远程信令</h3>
              <label className="meeting-room-name-input" style={{ gridTemplateColumns: '68px 1fr' }}>
                服务地址
                <input
                  value={signalServerUrl}
                  onChange={(e) => setSignalServerUrl(e.target.value)}
                  placeholder="例如 http://192.168.1.10:8787"
                />
              </label>
              <label className="meeting-room-name-input" style={{ gridTemplateColumns: '68px 1fr' }}>
                房间标识
                <input
                  value={signalRoomKey}
                  onChange={(e) => setSignalRoomKey(e.target.value)}
                  placeholder="默认使用共享房间码"
                />
              </label>
              <div className="meeting-room-actions-inline">
                <button className="meeting-btn-secondary" onClick={saveSignalConfig}>保存配置</button>
                <button className="meeting-btn-secondary" onClick={clearSignalConfig}>切回本地</button>
                <button className="meeting-btn-secondary" onClick={() => void copyInviteInfo()}>复制邀请</button>
              </div>
              <h3 style={{ marginTop: 12 }}>在线参会人</h3>
              <div className="meeting-room-participants">
                {participants.length === 0 ? (
                  <span className="meeting-room-participant-empty">暂无在线参会人</span>
                ) : (
                  participants.map((p) => (
                    <span key={p.id} className="meeting-room-participant-chip">
                      {p.user_name}
                    </span>
                  ))
                )}
              </div>
              <p className="meeting-room-hint">当前为第1阶段会议页骨架，已支持房间状态与在线参会人同步，后续接入实时音视频流。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
