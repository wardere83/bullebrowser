import { useEffect, useState } from 'react';
import type { AgentStepEvent } from '../../shared/agent-events.js';
import { replayGif } from '../lib/replay-gif.js';

export function TaskReplay({ steps }: { steps: readonly AgentStepEvent[] }) {
  const frames = steps.flatMap((step) => step.kind === 'replay' ? [step.frame] : []);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setIndex((i) => {
      if (i >= frames.length - 1) { setPlaying(false); return i; }
      return i + 1;
    }), 750);
    return () => clearInterval(timer);
  }, [playing, frames.length]);
  if (!frames.length) return null;
  const frame = frames[Math.min(index, frames.length - 1)]!;
  async function exportGif() {
    setExporting(true); setError('');
    try {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
      const pixels: Uint8ClampedArray[] = [];
      for (const item of frames) {
        const img = new Image(); img.src = item.image; await img.decode();
        context.fillStyle = 'white'; context.fillRect(0, 0, 320, 200);
        const scale = Math.min(320 / img.width, 200 / img.height);
        const width = img.width * scale, height = img.height * scale;
        context.drawImage(img, 0, 0, width, height);
        if (item.cursor) {
          context.beginPath(); context.arc(item.cursor.x * width, item.cursor.y * height, 4, 0, Math.PI * 2);
          context.fillStyle = '#20bad1'; context.fill();
        }
        pixels.push(context.getImageData(0, 0, 320, 200).data);
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      const bytes = replayGif(320, 200, pixels);
      const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'image/gif' }));
      const link = document.createElement('a'); link.href = url; link.download = 'bullebrowser-replay.gif'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError('Replay export failed. The recorded steps are still available.'); }
    finally { setExporting(false); }
  }
  return <details className="mb-3" aria-label="Task replay">
    <summary className="cursor-pointer">Replay ({frames.length} recorded page states)</summary>
    <p className="my-2 text-ink-secondary">Recorded snapshots and actual cursor positions. Playback does not perform browser actions.</p>
    <div className="relative overflow-hidden rounded border border-line">
      <img src={frame.image} alt={`Recorded page after ${frame.tool}`} className="block w-full" />
      {frame.cursor && <span aria-hidden="true" className="absolute h-3 w-3 rounded-full border-2 border-white bg-primary transition-all duration-150" style={{ left: `${frame.cursor.x * 100}%`, top: `${frame.cursor.y * 100}%`, transform: 'translate(-50%, -50%)' }} />}
    </div>
    <input type="range" aria-label="Replay step" min={0} max={frames.length - 1} value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)); }} className="w-full" />
    <p>{index + 1}/{frames.length} · {frame.tool} · {new Date(frame.at).toLocaleTimeString()}</p>
    <button type="button" className="text-primary" onClick={() => document.getElementById(`call-${frame.callId}`)?.scrollIntoView({ block: 'nearest' })}>Show tool call</button>
    <div className="mt-2 flex gap-3">
      <button type="button" onClick={() => { if (index === frames.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? 'Pause replay' : 'Play replay'}</button>
      <button type="button" disabled={exporting} onClick={() => void exportGif()}>{exporting ? 'Exporting…' : 'Export replay GIF'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </details>;
}
