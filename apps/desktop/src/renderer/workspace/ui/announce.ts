// One polite voice for the workspace. Anything that happens without moving
// focus (a screen opened from the navigation, a button that went busy, a
// result that arrived) is said through `announce`, and the single live region
// the workspace mounts (<Announcer />) speaks it. One region instead of many
// keeps assistive technology from talking over itself.

type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/** Says something to assistive technology without moving focus. */
export function announce(message: string): void {
  const text = message.trim();
  if (!text) return;
  for (const listener of [...listeners]) listener(text);
}

/** Used by <Announcer /> to receive what is announced. */
export function onAnnouncement(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
