import React from 'react';
import { ControlMode } from '../types';
import { Film, LogOut } from 'lucide-react';

interface Props {
  isHost: boolean;
  controlMode: ControlMode;
  pauseOnBuffer: boolean;
  onUpdateSettings: (mode: ControlMode, pauseOnBuf: boolean) => void;
  onOpenVideoPicker: () => void;
  onLeaveRoom: () => void;
}

export const RoomControls: React.FC<Props> = ({
  isHost,
  controlMode,
  pauseOnBuffer,
  onUpdateSettings,
  onOpenVideoPicker,
  onLeaveRoom,
}) => {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-white/[0.08]">
        <h3 className="text-xs font-semibold tracking-wide uppercase text-neutral-400">
          Room Settings
        </h3>
        <button
          onClick={onLeaveRoom}
          className="text-xs text-neutral-400 hover:text-rose-400 flex items-center gap-1.5 transition-colors py-1"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Leave room</span>
        </button>
      </div>

      {isHost ? (
        <div className="space-y-4 text-xs">
          {/* Change Video Action */}
          <div>
            <label className="text-[11px] font-medium text-neutral-400 block mb-1.5 uppercase tracking-wide">
              Media
            </label>
            <button
              onClick={onOpenVideoPicker}
              className="w-full h-9 px-3 bg-white/[0.05] hover:bg-white/[0.1] text-neutral-200 hover:text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2 border border-white/[0.08]"
            >
              <Film className="w-3.5 h-3.5 text-neutral-400" />
              <span>Change video</span>
            </button>
          </div>

          {/* Control Mode Segmented Control */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-neutral-400 block uppercase tracking-wide">
              Playback Control
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-white/[0.03] border border-white/[0.06] rounded-lg">
              <button
                type="button"
                onClick={() => onUpdateSettings('HOST_ONLY', pauseOnBuffer)}
                className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                  controlMode === 'HOST_ONLY'
                    ? 'bg-white text-black shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Host only
              </button>

              <button
                type="button"
                onClick={() => onUpdateSettings('EVERYONE', pauseOnBuffer)}
                className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                  controlMode === 'EVERYONE'
                    ? 'bg-white text-black shadow-sm'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Everyone
              </button>
            </div>
          </div>

          {/* Pause on Buffer Toggle */}
          <div className="flex items-center justify-between pt-1">
            <div className="space-y-0.5">
              <span className="text-neutral-300 font-medium block text-xs">
                Pause on buffering
              </span>
              <span className="text-[11px] text-neutral-500 block leading-tight">
                Pause room if someone buffers
              </span>
            </div>
            <input
              type="checkbox"
              checked={pauseOnBuffer}
              onChange={(e) => onUpdateSettings(controlMode, e.target.checked)}
              className="w-4 h-4 rounded accent-white bg-[#121215] border-white/20 cursor-pointer"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-xs">
          <div className="p-3 rounded-lg bg-white/[0.03] border border-white/[0.06] flex items-center justify-between">
            <span className="text-neutral-400">Playback control:</span>
            <span className="font-medium text-neutral-200">
              {controlMode === 'HOST_ONLY' ? 'Host only' : 'Everyone'}
            </span>
          </div>
          <p className="text-[11px] text-neutral-500 leading-relaxed">
            {controlMode === 'HOST_ONLY'
              ? 'Only the room host can play, pause, seek, or change video.'
              : 'All participants can control playback.'}
          </p>
        </div>
      )}
    </div>
  );
};

