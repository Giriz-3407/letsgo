import React, { useRef, useState, useEffect } from 'react';
import { PlaybackChangeSource } from '../types';
import { PlaybackSynchronizer } from '../sync/PlaybackSynchronizer';
import {
  Play,
  Pause,
  Volume1,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Shield,
  Loader2,
  Film,
  ChevronDown,
  Check,
  FolderOpen,
} from 'lucide-react';

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const RotateLeft10Icon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <text
      x="12"
      y="15.5"
      textAnchor="middle"
      fontSize="8"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
      fontFamily="system-ui, -apple-system, sans-serif"
    >
      10
    </text>
  </svg>
);

const RotateRight10Icon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <text
      x="12"
      y="15.5"
      textAnchor="middle"
      fontSize="8"
      fontWeight="700"
      fill="currentColor"
      stroke="none"
      fontFamily="system-ui, -apple-system, sans-serif"
    >
      10
    </text>
  </svg>
);


interface Props {
  synchronizer: PlaybackSynchronizer | null;
  canControl: boolean;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
  selectedFileName?: string | null;
  onFileSelect?: (file: File | null) => void;
  videoSrc?: string | null;
}

export const VideoPlayer: React.FC<Props> = ({
  synchronizer,
  canControl,
  playbackRate = 1.0,
  onPlaybackRateChange,
  selectedFileName,
  onFileSelect,
  videoSrc,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Local object URL & filename state
  const [internalObjectUrl, setInternalObjectUrl] = useState<string | null>(null);
  const [internalFileName, setInternalFileName] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const activeSrc = videoSrc !== undefined ? videoSrc : internalObjectUrl;
  const activeFileName = selectedFileName !== undefined ? selectedFileName : internalFileName;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const volumeRef = useRef(1);
  const isMutedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const controlsTimeoutRef = useRef<number | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);

  // Web Audio API refs for variable volume control on mobile (Android / iOS) and desktop
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const connectedVideoRef = useRef<HTMLVideoElement | null>(null);

  const setupAudioGraph = (videoEl: HTMLVideoElement) => {
    if (typeof window === 'undefined') return;
    if (connectedVideoRef.current === videoEl) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }
      const ctx = audioContextRef.current;

      if (!gainNodeRef.current) {
        const gain = ctx.createGain();
        const effectiveVol = isMutedRef.current ? 0 : volumeRef.current;
        gain.gain.value = effectiveVol * effectiveVol;
        gain.connect(ctx.destination);
        gainNodeRef.current = gain;
      }

      const source = ctx.createMediaElementSource(videoEl);
      source.connect(gainNodeRef.current);
      sourceNodeRef.current = source;
      connectedVideoRef.current = videoEl;

      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    } catch (err) {
      console.warn('[WebAudio] Could not attach MediaElementAudioSourceNode:', err);
    }
  };

  const applyAudioVolume = (vol: number, muted: boolean) => {
    volumeRef.current = vol;
    isMutedRef.current = muted;
    const effectiveVol = muted ? 0 : Math.max(0, Math.min(1, vol));
    // Quadratic taper: matches logarithmic decibel perception across 0.0 -> 1.0
    const gainVal = effectiveVol * effectiveVol;

    // Web Audio GainNode (provides true variable volume across mobile Android/iOS + desktop)
    if (gainNodeRef.current && audioContextRef.current) {
      try {
        const currentTime = audioContextRef.current.currentTime;
        gainNodeRef.current.gain.cancelScheduledValues(currentTime);
        gainNodeRef.current.gain.setValueAtTime(gainNodeRef.current.gain.value, currentTime);
        gainNodeRef.current.gain.linearRampToValueAtTime(gainVal, currentTime + 0.015);
      } catch (_) {
        try {
          gainNodeRef.current.gain.value = gainVal;
        } catch (_) {}
      }
    }

    // Video element native volume / muted properties
    if (videoRef.current) {
      videoRef.current.muted = muted || effectiveVol === 0;
      try {
        if (gainNodeRef.current) {
          // If muted, ensure native volume is also 0; otherwise 1.0 when GainNode handles attenuation
          videoRef.current.volume = muted || effectiveVol === 0 ? 0 : 1.0;
        } else {
          // Native fallback when Web Audio is not available
          videoRef.current.volume = effectiveVol;
        }
      } catch (_) {}
    }
  };

  const ensureAudioRunning = () => {
    if (videoRef.current) {
      setupAudioGraph(videoRef.current);
    }
    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
  };

  // Double-tap and touch gesture state
  const [doubleTapFeedback, setDoubleTapFeedback] = useState<{
    side: 'left' | 'right';
    text: string;
    key: number;
  } | null>(null);

  const isSeekingRef = useRef<boolean>(false);
  const lastTapRef = useRef<{ time: number; x: number; y: number; side: 'left' | 'right' } | null>(null);
  const singleTapTimeoutRef = useRef<number | null>(null);
  const doubleTapCountRef = useRef<number>(0);
  const feedbackTimeoutRef = useRef<number | null>(null);

  const triggerDoubleTapFeedback = (side: 'left' | 'right', deltaSeconds: number, customText?: string) => {
    if (feedbackTimeoutRef.current) {
      clearTimeout(feedbackTimeoutRef.current);
    }
    const absSeconds = Math.abs(deltaSeconds);
    const sign = deltaSeconds > 0 ? '+' : '-';
    const text = customText || `${sign}${absSeconds}s`;
    setDoubleTapFeedback({
      side,
      text,
      key: Date.now(),
    });
    feedbackTimeoutRef.current = window.setTimeout(() => {
      setDoubleTapFeedback(null);
      doubleTapCountRef.current = 0;
    }, 850);
  };

  const handleVideoTap = (e: React.MouseEvent<HTMLDivElement>) => {
    ensureAudioRunning();

    // Check if the interaction originated from a touch screen / mobile device
    const isTouch =
      (e.nativeEvent as PointerEvent)?.pointerType === 'touch' ||
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
      window.innerWidth < 1024;

    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;
    const isRightSide = clickX > rect.width / 2;
    const side: 'left' | 'right' = isRightSide ? 'right' : 'left';
    const now = Date.now();

    const prevTap = lastTapRef.current;

    // Detect double tap (or rapid subsequent taps on the same side within 350ms)
    if (
      prevTap &&
      now - prevTap.time < 350 &&
      prevTap.side === side &&
      Math.abs(clickX - prevTap.x) < 100 &&
      Math.abs(clickY - prevTap.y) < 100
    ) {
      // Cancel pending single tap action so controls aren't toggled
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
        singleTapTimeoutRef.current = null;
      }

      doubleTapCountRef.current += 1;
      lastTapRef.current = { time: now, x: clickX, y: clickY, side };

      if (canControl) {
        const step = side === 'right' ? 10 : -10;
        const totalDelta = step * doubleTapCountRef.current;
        handleSkip(step);
        triggerDoubleTapFeedback(side, totalDelta);
      } else {
        triggerDoubleTapFeedback(side, 0, 'Host controls playback');
      }
      return;
    }

    // Reset double tap counter on new initial tap (0 skips so double tap becomes 1 skip = 10s)
    doubleTapCountRef.current = 0;
    lastTapRef.current = { time: now, x: clickX, y: clickY, side };

    if (singleTapTimeoutRef.current) {
      clearTimeout(singleTapTimeoutRef.current);
    }

    // Schedule single tap resolution
    singleTapTimeoutRef.current = window.setTimeout(() => {
      singleTapTimeoutRef.current = null;
      lastTapRef.current = null;
      doubleTapCountRef.current = 0;

      if (isTouch) {
        // ON MOBILE:
        // Clicking anywhere on the screen MUST NOT pause the video directly.
        // Instead, single tap toggles controls visibility with auto-hide timer.
        if (controlsTimeoutRef.current) {
          clearTimeout(controlsTimeoutRef.current);
          controlsTimeoutRef.current = null;
        }
        setShowControls((prev) => {
          const next = !prev;
          if (next && isPlaying) {
            controlsTimeoutRef.current = window.setTimeout(() => {
              setShowControls(false);
            }, 3500);
          }
          return next;
        });
      } else {
        // ON DESKTOP (MOUSE):
        // Single click on video toggles play/pause as expected on desktop
        togglePlayPause();
      }
    }, 260);
  };

  // Handle local video file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Initialize audio context on file select gesture
    if (typeof window !== 'undefined') {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass && !audioContextRef.current) {
        try {
          audioContextRef.current = new AudioContextClass();
        } catch (_) {}
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
      }
    }

    // Revoke previous object URL if any
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    // Stop and reset previous video element
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    // Create local object URL
    const newUrl = URL.createObjectURL(file);
    objectUrlRef.current = newUrl;
    setInternalObjectUrl(newUrl);
    setInternalFileName(file.name);
    onFileSelect?.(file);

    // Reset input value so selecting the same file triggers change if desired
    e.target.value = '';
  };

  // Cleanup object URL and orientation on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      // Unlock orientation if still in landscape
      const orientation = (window.screen?.orientation || (window.screen as any)?.mozOrientation || (window.screen as any)?.msOrientation) as any;
      if (orientation && typeof orientation.unlock === 'function') {
        try {
          orientation.unlock();
        } catch (_) {}
      }
      // Close Web Audio context
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (singleTapTimeoutRef.current) {
        clearTimeout(singleTapTimeoutRef.current);
        singleTapTimeoutRef.current = null;
      }
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
        feedbackTimeoutRef.current = null;
      }
      gainNodeRef.current = null;
      sourceNodeRef.current = null;
      connectedVideoRef.current = null;
    };
  }, []);

  // Sync fullscreen state with browser events (e.g. Android back button, Escape key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement
      );
      setIsFullscreen(isFs);

      // If user exited fullscreen via gesture/back button, release orientation lock
      if (!isFs) {
        const orientation = (window.screen?.orientation || (window.screen as any)?.mozOrientation || (window.screen as any)?.msOrientation) as any;
        if (orientation && typeof orientation.unlock === 'function') {
          try {
            orientation.unlock();
          } catch (_) {}
        }
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Attach video element to PlaybackSynchronizer
  useEffect(() => {
    if (!videoRef.current || !synchronizer || !activeSrc) return;
    const detach = synchronizer.attachVideo(videoRef.current);
    return () => {
      detach();
    };
  }, [synchronizer, activeSrc]);

  // Video event listeners for local UI state
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    const onPlay = () => {
      setIsPlaying(true);
      ensureAudioRunning();
    };
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      if (isSeekingRef.current) return;
      setCurrentTime(el.currentTime);
      if (el.buffered.length > 0) {
        setBufferedEnd(el.buffered.end(el.buffered.length - 1));
      }
    };
    const onLoadedMetadata = () => {
      setDuration(el.duration);
      setupAudioGraph(el);
      applyAudioVolume(volumeRef.current, isMutedRef.current);
    };
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
      ensureAudioRunning();
    };
    const onCanPlay = () => {
      setIsBuffering(false);
      setupAudioGraph(el);
      applyAudioVolume(volumeRef.current, isMutedRef.current);
    };

    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    el.addEventListener('timeupdate', onTimeUpdate);
    el.addEventListener('loadedmetadata', onLoadedMetadata);
    el.addEventListener('waiting', onWaiting);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('canplay', onCanPlay);

    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
      el.removeEventListener('timeupdate', onTimeUpdate);
      el.removeEventListener('loadedmetadata', onLoadedMetadata);
      el.removeEventListener('waiting', onWaiting);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('canplay', onCanPlay);
    };
  }, [activeSrc]);

  // Close speed menu on outside click or Escape key
  useEffect(() => {
    if (!isSpeedMenuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setIsSpeedMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsSpeedMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSpeedMenuOpen]);

  // Controls auto-hide timer
  const handleMouseMove = () => {
    // Ignore synthetic mousemove events on touch devices so they don't override touch tap toggle logic
    if (
      (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      'ontouchstart' in window ||
      (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
    ) {
      return;
    }
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    controlsTimeoutRef.current = window.setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
      }
    }, 2800);
  };

  const togglePlayPause = () => {
    ensureAudioRunning();
    if (!canControl || !videoRef.current || !synchronizer) return;
    synchronizer.setChangeSource(PlaybackChangeSource.USER);
    if (videoRef.current.paused) {
      videoRef.current.play().catch(console.warn);
    } else {
      videoRef.current.pause();
    }
  };

  // Synchronized seek (+10 / -10 / +30 / -30)
  const handleSkip = (deltaSeconds: number) => {
    if (!canControl) {
      triggerDoubleTapFeedback(deltaSeconds > 0 ? 'right' : 'left', 0, 'Host controls playback');
      return;
    }
    if (!synchronizer) return;
    const dur = videoRef.current?.duration || duration || 0;
    const maxTime = !dur || isNaN(dur) || !isFinite(dur) ? 0 : dur;
    const baseTime = videoRef.current?.currentTime ?? currentTime ?? 0;
    const target =
      maxTime > 0
        ? Math.max(0, Math.min(maxTime, baseTime + deltaSeconds))
        : Math.max(0, baseTime + deltaSeconds);

    setCurrentTime(target);
    synchronizer.requestSeek(target);
  };

  // Synchronized manual seek slider
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canControl) {
      triggerDoubleTapFeedback('right', 0, 'Host controls playback');
      return;
    }
    if (!synchronizer) return;
    const target = parseFloat(e.target.value);
    setCurrentTime(target);
    synchronizer.requestSeek(target);
  };

  const currentSpeed = playbackRate ?? (synchronizer?.getUserPlaybackRate() || 1.0);

  const handleSelectSpeed = (speed: number) => {
    if (!canControl) return;
    setIsSpeedMenuOpen(false);
    if (onPlaybackRateChange) {
      onPlaybackRateChange(speed);
    } else if (synchronizer) {
      synchronizer.requestPlaybackRate(speed);
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    ensureAudioRunning();
    const val = parseFloat(e.target.value);
    setVolume(val);
    const nextMuted = val === 0;
    setIsMuted(nextMuted);
    applyAudioVolume(val, nextMuted);
  };

  const toggleMute = () => {
    ensureAudioRunning();
    const nextMuted = !isMutedRef.current;
    setIsMuted(nextMuted);
    let nextVol = volumeRef.current;
    if (!nextMuted && nextVol === 0) {
      nextVol = 0.5;
      setVolume(0.5);
    }
    applyAudioVolume(nextVol, nextMuted);
  };

  const handleVolumeDelta = (delta: number) => {
    ensureAudioRunning();
    const nextVol = Math.max(0, Math.min(1, Math.round((volumeRef.current + delta) * 100) / 100));
    setVolume(nextVol);
    const nextMuted = nextVol === 0;
    setIsMuted(nextMuted);
    applyAudioVolume(nextVol, nextMuted);
  };

  // Global keyboard shortcuts (Left/Right arrow seek 10s, Space toggle play, Up/Down volume, M mute)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (!activeSrc) return;

      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.key === 'ArrowLeft') {
        if (!canControl) return;
        e.preventDefault();
        handleSkip(-10);
      } else if (e.key === 'ArrowRight') {
        if (!canControl) return;
        e.preventDefault();
        handleSkip(10);
      } else if (e.key === ' ' || e.code === 'Space') {
        if (!canControl) return;
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleVolumeDelta(0.05);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleVolumeDelta(-0.05);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [canControl, activeSrc, duration, currentTime]);

  // Synchronize audio graph and volume on activeSrc change
  useEffect(() => {
    if (videoRef.current && activeSrc) {
      setupAudioGraph(videoRef.current);
      applyAudioVolume(volumeRef.current, isMutedRef.current);
    }
  }, [activeSrc]);

  // Fullscreen with mobile Landscape orientation lock
  const toggleFullscreen = async () => {
    const container = containerRef.current;
    if (!container) return;

    const isCurrentlyFullscreen = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );

    if (!isCurrentlyFullscreen) {
      try {
        // 1. Request fullscreen on container or fallback to video (iOS Safari)
        if (container.requestFullscreen) {
          await container.requestFullscreen();
        } else if ((container as any).webkitRequestFullscreen) {
          await (container as any).webkitRequestFullscreen();
        } else if ((videoRef.current as any)?.webkitEnterFullscreen) {
          (videoRef.current as any).webkitEnterFullscreen();
          setIsFullscreen(true);
          return;
        }

        setIsFullscreen(true);

        // 2. Lock screen orientation to landscape on mobile devices supporting ScreenOrientation API
        const orientation = (window.screen?.orientation || (window.screen as any)?.mozOrientation || (window.screen as any)?.msOrientation) as any;
        if (orientation && typeof orientation.lock === 'function') {
          try {
            await orientation.lock('landscape');
          } catch (err) {
            try {
              await orientation.lock('landscape-primary');
            } catch (_) {
              // Screen orientation lock not supported or allowed by user settings
            }
          }
        }
      } catch (err) {
        console.warn('[Fullscreen] Error entering fullscreen:', err);
      }
    } else {
      try {
        // 1. Unlock screen orientation
        const orientation = (window.screen?.orientation || (window.screen as any)?.mozOrientation || (window.screen as any)?.msOrientation) as any;
        if (orientation && typeof orientation.unlock === 'function') {
          try {
            orientation.unlock();
          } catch (_) {}
        }

        // 2. Exit fullscreen
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
        setIsFullscreen(false);
      } catch (err) {
        console.warn('[Fullscreen] Error exiting fullscreen:', err);
      }
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const bufferedPercentage = duration > 0 ? (bufferedEnd / duration) * 100 : 0;
  const currentPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

  // Render file selection placeholder when no local video is selected
  if (!activeSrc) {
    return (
      <div className="w-full aspect-video bg-[#0d0d10] border border-white/[0.08] rounded-xl flex flex-col items-center justify-center p-6 sm:p-8 text-center select-none shadow-2xl">
        <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-neutral-400 mb-3 sm:mb-4">
          <Film className="w-4 h-4 sm:w-5 sm:h-5" />
        </div>
        <h3 className="text-xs sm:text-sm font-medium text-neutral-200">
          Select the video file to start watching.
        </h3>
        <p className="text-[11px] sm:text-xs text-neutral-500 mt-1 max-w-sm leading-relaxed">
          Each participant selects their own copy of the video file from their computer. The video plays locally and stays in sync.
        </p>
        <label className="mt-5 sm:mt-6 h-8 sm:h-9 px-4 sm:px-5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer shadow-sm">
          <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-black" />
          <span>Select Video</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
          />
        </label>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onPointerDown={ensureAudioRunning}
      className={`relative w-full touch-manipulation ${
        isFullscreen
          ? 'fixed inset-0 z-50 h-screen w-screen rounded-none border-0'
          : 'aspect-video rounded-xl border border-white/[0.08]'
      } [&:fullscreen]:w-full [&:fullscreen]:h-full [&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:-webkit-full-screen]:w-full [&:-webkit-full-screen]:h-full [&:-webkit-full-screen]:rounded-none [&:-webkit-full-screen]:border-0 bg-black overflow-hidden group select-none shadow-2xl`}
    >
      {/* Hidden file input to allow replacing the video */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Native Video Element */}
      <video
        ref={videoRef}
        preload="auto"
        playsInline
        src={activeSrc}
        className="w-full h-full object-contain"
      />

      {/* Screen Gesture Layer (Single tap toggles controls without pausing on mobile; Double tap left: -10s, right: +10s) */}
      <div
        className="absolute inset-0 z-10 cursor-pointer select-none"
        onClick={handleVideoTap}
      />

      {/* Buffering Indicator - Non-blurring sleek central spinner */}
      {isBuffering && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none z-20">
          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-black/75 border border-white/20 flex items-center justify-center shadow-2xl">
            <Loader2 className="w-6 h-6 sm:w-7 sm:h-7 text-white/90 animate-spin" />
          </div>
        </div>
      )}

      {/* Center Play/Pause Indicator on Pause */}
      {!isPlaying && !isBuffering && showControls && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            togglePlayPause();
          }}
          disabled={!canControl}
          className="absolute inset-0 m-auto w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-black/50 hover:bg-black/70 border border-white/20 disabled:opacity-30 text-white flex items-center justify-center backdrop-blur-md transition-all transform hover:scale-105 z-20"
        >
          <Play className="w-5 h-5 sm:w-6 sm:h-6 ml-0.5 fill-white text-white" />
        </button>
      )}

      {/* Double Tap Feedback Overlay (z-30: ALWAYS on top of video, gesture layer, and buffering spinner) */}
      {doubleTapFeedback && (
        <div className="absolute inset-0 pointer-events-none z-30 select-none">
          {/* Double Tap Left Feedback (-10s) */}
          {doubleTapFeedback.side === 'left' && (
            <div
              key={doubleTapFeedback.key}
              className="absolute inset-y-0 left-0 w-1/2 flex flex-col items-center justify-center pointer-events-none select-none transition-all duration-300 animate-in fade-in"
            >
              {/* Blur background pill behind text and icon */}
              <div className="absolute inset-0 bg-white/[0.08] backdrop-blur-[2px] rounded-r-full pointer-events-none" />

              {/* Content layer positioned ABOVE the blur layer */}
              <div className="relative z-10 flex flex-col items-center justify-center pointer-events-none">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/80 border border-white/25 flex items-center justify-center text-white shadow-2xl mb-1.5 transform active:scale-95">
                  <RotateLeft10Icon className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                </div>
                <span className="text-xs sm:text-sm font-mono font-bold text-white tracking-wider bg-black/75 px-3.5 py-1 rounded-full border border-white/20 shadow-xl">
                  {doubleTapFeedback.text}
                </span>
              </div>
            </div>
          )}

          {/* Double Tap Right Feedback (+10s) */}
          {doubleTapFeedback.side === 'right' && (
            <div
              key={doubleTapFeedback.key}
              className="absolute inset-y-0 right-0 w-1/2 flex flex-col items-center justify-center pointer-events-none select-none transition-all duration-300 animate-in fade-in"
            >
              {/* Blur background pill behind text and icon */}
              <div className="absolute inset-0 bg-white/[0.08] backdrop-blur-[2px] rounded-l-full pointer-events-none" />

              {/* Content layer positioned ABOVE the blur layer */}
              <div className="relative z-10 flex flex-col items-center justify-center pointer-events-none">
                <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-black/80 border border-white/25 flex items-center justify-center text-white shadow-2xl mb-1.5 transform active:scale-95">
                  <RotateRight10Icon className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                </div>
                <span className="text-xs sm:text-sm font-mono font-bold text-white tracking-wider bg-black/75 px-3.5 py-1 rounded-full border border-white/20 shadow-xl">
                  {doubleTapFeedback.text}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Viewer Permission Badge */}
      {!canControl && showControls && (
        <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-20 flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-md bg-black/60 backdrop-blur border border-white/10 text-[10px] sm:text-[11px] text-neutral-300">
          <Shield className="w-3 h-3 text-neutral-400 flex-shrink-0" />
          <span className="whitespace-nowrap">Host controls playback</span>
        </div>
      )}

      {/* Unobtrusive Selected File Badge */}
      {activeFileName && showControls && (
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1 rounded-md bg-black/60 backdrop-blur border border-white/10 text-[10px] sm:text-[11px] text-neutral-300">
          <Film className="w-3 h-3 text-neutral-400 flex-shrink-0" />
          <span className="font-mono text-neutral-300 max-w-[110px] sm:max-w-[200px] truncate" title={activeFileName}>
            {activeFileName}
          </span>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] text-neutral-400 hover:text-white underline ml-0.5 cursor-pointer transition-colors flex-shrink-0"
            title="Choose a different video file"
          >
            Change
          </button>
        </div>
      )}

      {/* Bottom Control Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-8 sm:pt-10 pb-2 sm:pb-3 px-2 sm:px-4 transition-opacity duration-200 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Bar */}
        <div className="relative group/timeline w-full h-3 flex items-center mb-1.5 sm:mb-2 cursor-pointer">
          {/* Progress background track */}
          <div className="w-full h-1 group-hover/timeline:h-1.5 bg-white/20 rounded-full overflow-hidden relative transition-all">
            {/* Buffer progress */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-white/20 transition-all duration-150"
              style={{ width: `${bufferedPercentage}%` }}
            />
            {/* Playback progress */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-white"
              style={{ width: `${currentPercentage}%` }}
            />
          </div>

          {/* Range input slider */}
          <input
            type="range"
            min={0}
            max={duration || 100}
            step={0.1}
            value={currentTime}
            disabled={!canControl}
            onPointerDown={() => {
              isSeekingRef.current = true;
            }}
            onTouchStart={() => {
              isSeekingRef.current = true;
            }}
            onInput={(e) => {
              const target = parseFloat((e.target as HTMLInputElement).value);
              setCurrentTime(target);
            }}
            onChange={handleSeek}
            onPointerUp={() => {
              isSeekingRef.current = false;
            }}
            onTouchEnd={() => {
              isSeekingRef.current = false;
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-neutral-200 gap-1 sm:gap-2">
          {/* Left Controls */}
          <div className="flex items-center gap-1 sm:gap-2 min-w-0 flex-1 overflow-hidden">
            {/* Play / Pause */}
            <button
              onClick={togglePlayPause}
              disabled={!canControl}
              title={canControl ? (isPlaying ? 'Pause' : 'Play') : 'Host only control'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="p-1 sm:p-1.5 text-neutral-200 hover:text-white disabled:opacity-30 rounded transition-colors flex-shrink-0"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>

            {/* Skip Backward 10s */}
            <button
              onClick={() => handleSkip(-10)}
              disabled={!canControl}
              title={canControl ? 'Seek backward 10 seconds (-10s)' : 'Host only control'}
              aria-label="Seek backward 10 seconds"
              className="p-1 sm:p-1.5 text-neutral-300 hover:text-white disabled:opacity-30 rounded transition-colors flex-shrink-0"
            >
              <RotateLeft10Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {/* Skip Forward 10s */}
            <button
              onClick={() => handleSkip(10)}
              disabled={!canControl}
              title={canControl ? 'Seek forward 10 seconds (+10s)' : 'Host only control'}
              aria-label="Seek forward 10 seconds"
              className="p-1 sm:p-1.5 text-neutral-300 hover:text-white disabled:opacity-30 rounded transition-colors flex-shrink-0"
            >
              <RotateRight10Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>

            {/* Timestamps */}
            <div className="text-[10px] sm:text-[11px] font-mono text-neutral-300 select-none whitespace-nowrap flex-shrink-0">
              <span>{formatTime(currentTime)}</span>
              <span className="text-neutral-600 mx-1">/</span>
              <span className="text-neutral-400">{formatTime(duration)}</span>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1 ml-0.5 flex-shrink-0">
              <button
                type="button"
                onClick={toggleMute}
                className="p-1 sm:p-1.5 text-neutral-300 hover:text-white rounded transition-colors flex-shrink-0"
                title={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
                aria-label={isMuted || volume === 0 ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-neutral-400" />
                ) : volume < 0.5 ? (
                  <Volume1 className="w-4 h-4 text-neutral-200" />
                ) : (
                  <Volume2 className="w-4 h-4 text-neutral-200" />
                )}
              </button>
              {/* Variable Volume Slider - responsive width, works on mobile & desktop */}
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                aria-label="Volume"
                title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
                className="w-10 sm:w-14 md:w-16 h-1 bg-white/20 accent-white rounded cursor-pointer"
              />
            </div>
          </div>

          {/* Right Controls - ALWAYS VISIBLE, NEVER WRAPPED OR OVERFLOWN */}
          <div className="flex items-center gap-1 sm:gap-1.5 flex-shrink-0 ml-1">
            {/* Playback Speed Popover */}
            <div className="relative flex-shrink-0" ref={speedMenuRef}>
              <button
                type="button"
                onClick={() => {
                  if (canControl) {
                    setIsSpeedMenuOpen((prev) => !prev);
                  }
                }}
                disabled={!canControl}
                aria-label="Playback speed"
                aria-haspopup="true"
                aria-expanded={isSpeedMenuOpen}
                title={canControl ? `Playback speed (${currentSpeed}x)` : 'Host only control'}
                className="px-1.5 sm:px-2 py-1 text-[11px] sm:text-xs font-mono text-neutral-300 hover:text-white disabled:opacity-30 rounded hover:bg-white/[0.08] transition-colors flex items-center gap-0.5 sm:gap-1"
              >
                <span>{currentSpeed}x</span>
                <ChevronDown className="w-3 h-3 text-neutral-400" />
              </button>

              {isSpeedMenuOpen && (
                <div
                  role="menu"
                  aria-label="Playback speed options"
                  className="absolute bottom-full right-0 mb-2 py-1 w-24 bg-[#111114] border border-white/[0.1] rounded-lg shadow-2xl backdrop-blur-md z-30 flex flex-col"
                >
                  <div className="px-2.5 py-1 text-[10px] font-medium tracking-wider text-neutral-500 uppercase border-b border-white/[0.06] mb-1 select-none">
                    Speed
                  </div>
                  {SPEED_OPTIONS.map((speed) => {
                    const isSelected = currentSpeed === speed;
                    return (
                      <button
                        key={speed}
                        role="menuitem"
                        onClick={() => handleSelectSpeed(speed)}
                        className={`px-2.5 py-1.5 text-xs text-left font-mono flex items-center justify-between transition-colors ${
                          isSelected
                            ? 'bg-white text-black font-semibold'
                            : 'text-neutral-300 hover:bg-white/[0.08] hover:text-white'
                        }`}
                      >
                        <span>{speed}x</span>
                        {isSelected && <Check className="w-3 h-3 text-black stroke-[2.5]" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              className="p-1 sm:p-1.5 text-neutral-300 hover:text-white rounded transition-colors flex-shrink-0"
              aria-label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
