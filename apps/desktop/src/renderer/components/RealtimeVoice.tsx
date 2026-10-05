import { useEffect, useRef, useState } from 'react';
import {
  type VoiceState,
  type VoiceTaskResult,
  type VoiceTranscript,
} from '../lib/realtime-voice.js';
import { LocalVoiceSession } from '../lib/local-voice.js';

const INITIAL_STATE: VoiceState = {
  phase: 'connecting',
  muted: false,
  playbackBlocked: false,
};

const LABELS = {
  connecting: 'Connecting voice…',
  listening: 'Listening',
  thinking: 'Thinking…',
  speaking: 'Speaking',
  working: 'Working in your browser…',
  error: 'Voice could not continue',
  closed: 'Voice ended',
};

// Normal panel layout keeps browser progress and permission requests reachable
// during a spoken task. The dictation microphone still uses its own overlay.
export function RealtimeVoice({
  onBrowserTask,
  onClose,
}: {
  onBrowserTask: (prompt: string, signal: AbortSignal) => Promise<VoiceTaskResult>;
  onClose: () => void;
}) {
  const [state, setState] = useState<VoiceState>(INITIAL_STATE);
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(7).fill(0.12));
  const sessionRef = useRef<LocalVoiceSession | null>(null);
  const taskRef = useRef(onBrowserTask);
  const captionsRef = useRef<HTMLDivElement>(null);
  taskRef.current = onBrowserTask;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    let alive = true;
    let stopMeter = () => {};
    setState(INITIAL_STATE);
    setTranscripts([]);

    const session = new LocalVoiceSession({
      bridge: window.bullebrowser.voice,
      onState: (next) => {
        if (!alive) return;
        if (next.phase === 'error' || next.phase === 'closed') {
          stopMeter();
          setLevels(Array(7).fill(0.12));
        }
        setState(next);
      },
      onTranscript: (entry) => {
        if (!alive) return;
        setTranscripts((current) => {
          const index = current.findIndex((item) => item.id === entry.id && item.role === entry.role);
          const next = [...current];
          if (index < 0) next.push(entry);
          else next[index] = entry;
          return next.slice(-8);
        });
      },
      onBrowserTask: (prompt, signal) => taskRef.current(prompt, signal),
      onMicrophoneStream: (stream) => {
        stopMeter();
        if (!alive) return;
        let context: AudioContext | undefined;
        let source: MediaStreamAudioSourceNode | undefined;
        let frame = 0;
        let stopped = false;
        stopMeter = () => {
          stopped = true;
          cancelAnimationFrame(frame);
          source?.disconnect();
          void context?.close().catch(() => {});
        };
        try {
          context = new AudioContext();
          const analyser = context.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.75;
          source = context.createMediaStreamSource(stream);
          source.connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            if (!alive || stopped) return;
            analyser.getByteFrequencyData(data);
            const width = Math.floor(data.length / 7);
            setLevels(Array.from({ length: 7 }, (_, band) => {
              let total = 0;
              for (let index = 0; index < width; index++) total += data[band * width + index] ?? 0;
              return Math.max(0.12, Math.min(1, (total / width / 255) * 1.6));
            }));
            frame = requestAnimationFrame(tick);
          };
          void context.resume().catch(() => {});
          tick();
        } catch {
          // The meter is optional; a display failure must not end the call.
          stopMeter();
        }
      },
    });
    sessionRef.current = session;
    void session.start();
    return () => {
      alive = false;
      stopMeter();
      session.stop();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    const captions = captionsRef.current;
    if (captions) captions.scrollTop = captions.scrollHeight;
  }, [transcripts]);

  const ended = state.phase === 'error' || state.phase === 'closed';
  const label = state.muted && state.phase === 'listening' ? 'Microphone muted' : LABELS[state.phase];

  return (
    <section
      aria-label="Live Voice Mode"
      className="shrink-0 border-b border-line bg-primary/5 px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-primary">Voice Mode</div>
          <div className="mt-1 text-xs text-ink-secondary" role="status">{label}</div>
        </div>
        <div className={`bb-wave h-8 text-primary ${state.muted || ended ? 'bb-wave--idle' : ''}`} aria-hidden>
          {levels.map((level, index) => (
            <span
              key={index}
              className="bb-wave-bar"
              style={!reducedMotion && !state.muted && !ended ? { transform: `scaleY(${level.toFixed(3)})` } : undefined}
            />
          ))}
        </div>
      </div>

      {transcripts.length > 0 && (
        <div ref={captionsRef} className="mt-2 max-h-28 space-y-2 overflow-y-auto text-xs" aria-label="Voice conversation transcript">
          {transcripts.map((entry) => (
            <p key={`${entry.role}:${entry.id}`} className="break-words text-ink-secondary">
              <span className="font-semibold text-ink-primary">{entry.role === 'user' ? 'You' : 'BulleBrowser'}: </span>
              {entry.text}
            </p>
          ))}
        </div>
      )}
      {state.error && <p className="mt-2 text-xs text-danger" role="alert">{state.error}</p>}
      {state.playbackBlocked && (
        <button
          type="button"
          onClick={() => void sessionRef.current?.enableAudio()}
          className="mt-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
        >
          Enable voice audio
        </button>
      )}
      {!ended && state.phase !== 'connecting' && transcripts.length === 0 && (
        <p className="mt-2 text-xs text-ink-secondary">Speak a command. Voice uses local English transcription; first use downloads the speech model.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {ended ? (
          <button
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
          >
            Try voice again
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label={state.muted ? 'Unmute microphone' : 'Mute microphone'}
              aria-pressed={state.muted}
              onClick={() => sessionRef.current?.setMuted(!state.muted)}
              disabled={state.phase === 'connecting'}
              className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-muted disabled:opacity-50"
            >
              {state.muted ? 'Unmute' : 'Mute'}
            </button>
            {(state.phase === 'speaking' || state.phase === 'thinking') && (
              <button
                type="button"
                onClick={() => sessionRef.current?.interrupt()}
                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-muted"
              >
                Interrupt reply
              </button>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => {
            sessionRef.current?.stop();
            onClose();
          }}
          className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-muted"
        >
          Stop Voice Mode
        </button>
      </div>
    </section>
  );
}
