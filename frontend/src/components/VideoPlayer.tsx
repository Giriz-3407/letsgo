import React, { useRef, useState, useEffect } from 'react';
import { PlaybackChangeSource } from '../types';
import { PlaybackSynchronizer } from '../sync/PlaybackSynchronizer';
import {
  Play,
  Pause,
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
  const controlsTimeoutRef = useRef<number | null>(null);
  const speedMenuRef = useRef<HTMLDivElement | null>(null);

  // Handle local video file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
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

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(el.currentTime);
      if (el.buffered.length > 0) {
        setBufferedEnd(el.buffered.end(el.buffered.length - 1));
      }
    };
    const onLoadedMetadata = () => {
      setDuration(el.duration);
    };
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);

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
    if (!canControl || !videoRef.current || !synchronizer) return;
    synchronizer.setChangeSource(PlaybackChangeSource.USER);
    if (videoRef.current.paused) {
      videoRef.current.play().catch(console.warn);
    } else {
      videoRef.current.pause();
    }
  };

  // Synchronized seek (+10 / -10)
  const handleSkip = (deltaSeconds: number) => {
    if (!canControl || !synchronizer) return;
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
    if (!canControl || !synchronizer) return;
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

  // Global keyboard shortcuts (Left/Right arrow seek 10s, Space toggle play)
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
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [canControl, activeSrc, duration, currentTime]);

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMuted = !isMuted;
    setIsMuted(newMuted);
    videoRef.current.muted = newMuted;
    if (!newMuted && volume === 0) {
      setVolume(0.5);
      videoRef.current.volume = 0.5;
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(console.warn);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.warn);
      setIsFullscreen(false);
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
      <div className="w-full aspect-video bg-[#0d0d10] border border-white/[0.08] rounded-xl flex flex-col items-center justify-center p-8 text-center select-none shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-neutral-400 mb-4">
          <Film className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-medium text-neutral-200">
          Select the video file to start watching.
        </h3>
        <p className="text-xs text-neutral-500 mt-1.5 max-w-sm leading-relaxed">
          Each participant selects their own copy of the video file from their computer. The video plays locally and stays in sync.
        </p>
        <label className="mt-6 h-9 px-5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-2 cursor-pointer shadow-sm">
          <FolderOpen className="w-4 h-4 text-black" />
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
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group border border-white/[0.08] select-none shadow-2xl"
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
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlayPause}
      />

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none z-10">
          <Loader2 className="w-8 h-8 text-white/80 animate-spin" />
        </div>
      )}

      {/* Center Play/Pause Indicator on Pause */}
      {!isPlaying && !isBuffering && (
        <button
          onClick={togglePlayPause}
          disabled={!canControl}
          className="absolute inset-0 m-auto w-14 h-14 rounded-full bg-black/50 hover:bg-black/70 border border-white/20 disabled:opacity-30 text-white flex items-center justify-center backdrop-blur-md transition-all transform hover:scale-105 z-10"
        >
          <Play className="w-6 h-6 ml-0.5 fill-white text-white" />
        </button>
      )}

      {/* Viewer Permission Badge */}
      {!canControl && showControls && (
        <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur border border-white/10 text-[11px] text-neutral-300">
          <Shield className="w-3 h-3 text-neutral-400" />
          <span>Host controls playback</span>
        </div>
      )}

      {/* Unobtrusive Selected File Badge */}
      {activeFileName && showControls && (
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 px-2.5 py-1 rounded-md bg-black/60 backdrop-blur border border-white/10 text-[11px] text-neutral-300">
          <Film className="w-3 h-3 text-neutral-400 flex-shrink-0" />
          <span className="font-mono text-neutral-300 max-w-[200px] truncate" title={activeFileName}>
            {activeFileName}
          </span>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-[10px] text-neutral-400 hover:text-white underline ml-1 cursor-pointer transition-colors flex-shrink-0"
            title="Choose a different video file"
          >
            Change
          </button>
        </div>
      )}

      {/* Bottom Control Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-10 pb-3 px-4 transition-opacity duration-200 z-20 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Bar */}
        <div className="relative group/timeline w-full h-3 flex items-center mb-2.5 cursor-pointer">
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
            onChange={handleSeek}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between text-neutral-200">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Play / Pause */}
            <button
              onClick={togglePlayPause}
              disabled={!canControl}
              title={canControl ? (isPlaying ? 'Pause' : 'Play') : 'Host only control'}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              className="p-1.5 text-neutral-200 hover:text-white disabled:opacity-30 rounded transition-colors"
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
              className="p-1.5 text-neutral-300 hover:text-white disabled:opacity-30 rounded transition-colors"
            >
              <RotateLeft10Icon className="w-4 h-4" />
            </button>

            {/* Skip Forward 10s */}
            <button
              onClick={() => handleSkip(10)}
              disabled={!canControl}
              title={canControl ? 'Seek forward 10 seconds (+10s)' : 'Host only control'}
              aria-label="Seek forward 10 seconds"
              className="p-1.5 text-neutral-300 hover:text-white disabled:opacity-30 rounded transition-colors"
            >
              <RotateRight10Icon className="w-4 h-4" />
            </button>

            {/* Timestamps */}
            <div className="text-[11px] font-mono text-neutral-300 select-none">
              <span>{formatTime(currentTime)}</span>
              <span className="text-neutral-600 mx-1.5">/</span>
              <span className="text-neutral-400">{formatTime(duration)}</span>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1.5 ml-1">
              <button
                onClick={toggleMute}
                className="p-1.5 text-neutral-300 hover:text-white rounded transition-colors"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-neutral-400" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-14 h-1 bg-white/20 accent-white rounded cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Playback Speed Popover */}
            <div className="relative" ref={speedMenuRef}>
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
                className="px-2 py-1 text-xs font-mono text-neutral-300 hover:text-white disabled:opacity-30 rounded hover:bg-white/[0.08] transition-colors flex items-center gap-1"
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

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              className="p-1.5 text-neutral-400 hover:text-white rounded transition-colors"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
