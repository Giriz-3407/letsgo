import React, { useRef, useState, useEffect } from 'react';
import { VideoMetadata, ControlMode, PlaybackChangeSource } from '../types';
import { PlaybackSynchronizer } from '../sync/PlaybackSynchronizer';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Download,
  AlertCircle,
  RotateCcw,
  Loader2,
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
    }, 3000);
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
      <div className="w-full aspect-video bg-slate-900 border border-slate-800 rounded-2xl flex flex-col items-center justify-center p-6 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-blue-950/60 border border-blue-800/60 flex items-center justify-center text-blue-400 mb-4">
          <Play className="w-8 h-8 ml-1" />
        </div>
        <h3 className="text-base font-semibold text-slate-200">No video selected for this room</h3>
        <p className="text-xs text-slate-400 mt-1 max-w-sm">
          {canControl
            ? 'Select a video from local sample storage, upload an MP4, or choose a file from Google Drive.'
            : 'Waiting for the room host to select a movie or video...'}
        </p>
        {canControl && onOpenPicker && (
          <button
            onClick={onOpenPicker}
            className="mt-4 py-2.5 px-5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl transition shadow-lg shadow-blue-950"
          >
            Select Movie
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="relative w-full aspect-video bg-black rounded-2xl overflow-hidden group shadow-2xl border border-slate-800 select-none"
    >
      {/* Native HTML5 Video Element */}
      <video
        ref={videoRef}
        preload="auto"
        playsInline
        src={video.streamUrl}
        className="w-full h-full object-contain cursor-pointer"
        onClick={togglePlayPause}
      />

      {/* Buffering Spinner Overlay */}
      {isBuffering && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none">
          <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
          <span className="text-xs font-medium text-slate-200 mt-2">Buffering stream...</span>
        </div>
      )}

      {/* Big Center Play/Pause button on Hover/Click */}
      {!isPlaying && !isBuffering && (
        <button
          onClick={togglePlayPause}
          disabled={!canControl}
          className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-blue-600/90 hover:bg-blue-500 disabled:opacity-40 text-white flex items-center justify-center shadow-xl backdrop-blur-sm transition transform hover:scale-105"
        >
          <Play className="w-8 h-8 ml-1 fill-white" />
        </button>
      )}

      {/* Permission Warning Overlay if cannot control */}
      {!canControl && showControls && (
        <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 backdrop-blur text-[11px] text-amber-300 border border-amber-800/40">
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Host-Only Control Active</span>
        </div>
      )}

      {/* Bottom Control Bar */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent p-4 transition-opacity duration-200 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Timeline Scrub Bar */}
        <div className="relative group/timeline w-full h-3 flex items-center mb-2 cursor-pointer">
          {/* Track background */}
          <div className="w-full h-1.5 bg-slate-700/60 rounded-full overflow-hidden relative">
            {/* Buffer progress */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-slate-500/50 transition-all duration-150"
              style={{ width: `${bufferedPercentage}%` }}
            />
            {/* Playback progress */}
            <div
              className="absolute left-0 top-0 bottom-0 bg-blue-500"
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

        {/* Buttons Row */}
        <div className="flex items-center justify-between text-slate-200">
          <div className="flex items-center gap-3">
            {/* Play / Pause */}
            <button
              onClick={togglePlayPause}
              disabled={!canControl}
              title={canControl ? (isPlaying ? 'Pause' : 'Play') : 'Host only control'}
              className="p-2 hover:bg-white/10 disabled:opacity-40 rounded-lg transition"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            {/* Timestamps */}
            <div className="text-xs font-mono text-slate-300">
              <span>{formatTime(currentTime)}</span>
              <span className="text-slate-500 mx-1">/</span>
              <span className="text-slate-400">{formatTime(duration)}</span>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1.5 ml-2 group/volume">
              <button
                onClick={toggleMute}
                className="p-1.5 hover:bg-white/10 rounded-lg transition"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-slate-400" />
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
                className="w-16 h-1 bg-slate-700 accent-blue-500 rounded-lg cursor-pointer"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Download video button if allowed */}
            {video.downloadUrl && (
              <a
                href={video.downloadUrl}
                download
                title="Download video file"
                className="p-2 hover:bg-white/10 rounded-lg transition text-slate-300 hover:text-white"
              >
                <Download className="w-4 h-4" />
              </a>
            )}

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-2 hover:bg-white/10 rounded-lg transition"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
