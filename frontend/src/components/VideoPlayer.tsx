import React, { useRef, useState, useEffect } from 'react';
import { VideoMetadata, PlaybackChangeSource } from '../types';
import { resolveMediaUrl } from '../config';
import { PlaybackSynchronizer } from '../sync/PlaybackSynchronizer';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Download,
  Shield,
  Loader2,
  Film,
} from 'lucide-react';

interface Props {
  video: VideoMetadata | null;
  synchronizer: PlaybackSynchronizer | null;
  canControl: boolean;
  onOpenPicker?: () => void;
}

export const VideoPlayer: React.FC<Props> = ({
  video,
  synchronizer,
  canControl,
  onOpenPicker,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const controlsTimeoutRef = useRef<number | null>(null);

  // Attach video element to PlaybackSynchronizer
  useEffect(() => {
    if (!videoRef.current || !synchronizer) return;
    const detach = synchronizer.attachVideo(videoRef.current);
    return () => {
      detach();
    };
  }, [synchronizer, video?.streamUrl]);

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
  }, []);

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

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canControl || !videoRef.current || !synchronizer) return;
    const target = parseFloat(e.target.value);
    synchronizer.setChangeSource(PlaybackChangeSource.USER);
    videoRef.current.currentTime = target;
    setCurrentTime(target);
  };

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

  if (!video) {
    return (
      <div className="w-full aspect-video bg-[#0d0d10] border border-white/[0.08] rounded-xl flex flex-col items-center justify-center p-8 text-center select-none">
        <div className="w-12 h-12 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-neutral-400 mb-4">
          <Film className="w-5 h-5" />
        </div>
        <h3 className="text-sm font-medium text-neutral-200">No video selected</h3>
        <p className="text-xs text-neutral-500 mt-1 max-w-xs leading-relaxed">
          {canControl
            ? 'Choose a media file from local storage, upload a file, or connect Google Drive.'
            : 'Waiting for the host to select something to watch...'}
        </p>
        {canControl && onOpenPicker && (
          <button
            onClick={onOpenPicker}
            className="mt-5 h-9 px-4 bg-white hover:bg-neutral-200 text-black text-xs font-medium rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <span>Choose media</span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative w-full aspect-video bg-black rounded-xl overflow-hidden group border border-white/[0.08] select-none shadow-2xl"
    >
      {/* Native Video Element */}
      <video
        ref={videoRef}
        preload="auto"
        playsInline
        src={resolveMediaUrl(video.streamUrl)}
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
          <div className="flex items-center gap-3">
            {/* Play / Pause */}
            <button
              onClick={togglePlayPause}
              disabled={!canControl}
              title={canControl ? (isPlaying ? 'Pause' : 'Play') : 'Host only control'}
              className="p-1.5 text-neutral-200 hover:text-white disabled:opacity-30 rounded transition-colors"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
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
            {/* Download video button if allowed */}
            {video.downloadUrl && (
              <a
                href={resolveMediaUrl(video.downloadUrl)}
                download
                title="Download video"
                className="p-1.5 text-neutral-400 hover:text-white rounded transition-colors"
              >
                <Download className="w-4 h-4" />
              </a>
            )}

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
