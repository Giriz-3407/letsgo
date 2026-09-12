import React from 'react';
import { ControlMode } from '../types';
import { Settings, Shield, Users, Film, PauseCircle, LogOut } from 'lucide-react';

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
    <div className="bg-slate-900/80 backdrop-blur border border-slate-800 rounded-xl p-4 shadow-lg space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <Settings className="w-4 h-4 text-blue-400" />
          <h3 className="text-sm font-semibold text-slate-200">Room Controls</h3>
        </div>
        <button
          onClick={onLeaveRoom}
          className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 transition"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Leave</span>
        </button>
      </div>

      {isHost ? (
        <div className="space-y-3.5 text-xs">
          {/* Change Video Button */}
          <button
            onClick={onOpenVideoPicker}
            className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg font-medium transition flex items-center justify-center gap-2 border border-slate-700"
          >
            <Film className="w-4 h-4 text-blue-400" />
            <span>Change Video</span>
          </button>

          {/* Control Mode */}
          <div className="space-y-1.5">
            <span className="text-slate-400 font-medium block">Who can control playback:</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => onUpdateSettings('HOST_ONLY', pauseOnBuffer)}
                className={`py-2 px-2.5 rounded-lg border text-center font-medium transition flex items-center justify-center gap-1.5 ${
                  controlMode === 'HOST_ONLY'
                    ? 'bg-blue-950/60 border-blue-600 text-blue-300 shadow-sm'
                    : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                <span>Host Only</span>
              </button>

              <button
                type="button"
                onClick={() => onUpdateSettings('EVERYONE', pauseOnBuffer)}
                className={`py-2 px-2.5 rounded-lg border text-center font-medium transition flex items-center justify-center gap-1.5 ${
                  controlMode === 'EVERYONE'
                    ? 'bg-blue-950/60 border-blue-600 text-blue-300 shadow-sm'
                    : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Users className="w-3.5 h-3.5 text-emerald-400" />
                <span>Everyone</span>
              </button>
            </div>
          </div>

          {/* Pause on Buffer Toggle */}
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-slate-300">
              <PauseCircle className="w-4 h-4 text-slate-400" />
              <span>Pause everyone if someone buffers</span>
            </div>
            <input
              type="checkbox"
              checked={pauseOnBuffer}
              onChange={(e) => onUpdateSettings(controlMode, e.target.checked)}
              className="w-4 h-4 rounded text-blue-600 bg-slate-950 border-slate-700 focus:ring-blue-600 cursor-pointer"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2 text-xs text-slate-400">
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/40 border border-slate-800/80">
            <span>Playback Control:</span>
            <span className="font-semibold text-slate-200">
              {controlMode === 'HOST_ONLY' ? 'Host Only' : 'Everyone'}
            </span>
          </div>
          <p className="text-[11px] text-slate-500">
            {controlMode === 'HOST_ONLY'
              ? 'Only the host can play, pause, seek, or change video.'
              : 'All room participants can play, pause, or seek.'}
          </p>
        </div>
      )}
    </div>
  );
};
