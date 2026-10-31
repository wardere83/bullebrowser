export type TaskCommand = 'pause' | 'resume' | 'step' | 'replan' | 'follow' | 'unfollow';
/** Cooperative control at tool boundaries; Stop still uses the abort signal. */
export class TaskControl {
  paused = false;
  follow = true;
  private permits = 0;
  private replanning = false;
  private waiters = new Set<() => void>();
  command(command: TaskCommand): void {
    if (command === 'pause') { this.paused = true; this.permits = 0; }
    if (command === 'resume') { this.paused = false; this.permits = 0; }
    if (command === 'step') { this.paused = true; this.permits++; }
    if (command === 'replan') { this.replanning = true; this.paused = false; }
    if (command === 'follow') this.follow = true;
    if (command === 'unfollow') this.follow = false;
    for (const wake of this.waiters) wake();
  }
  takeReplan(): boolean { const value = this.replanning; this.replanning = false; return value; }
  async beforeTool(signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new Error('cancelled');
      if (!this.paused) return;
      if (this.permits > 0) { this.permits--; return; }
      await new Promise<void>((resolve) => {
        const wake = () => { this.waiters.delete(wake); signal.removeEventListener('abort', wake); resolve(); };
        this.waiters.add(wake);
        signal.addEventListener('abort', wake, { once: true });
        if (signal.aborted) wake();
      });
    }
  }
}
