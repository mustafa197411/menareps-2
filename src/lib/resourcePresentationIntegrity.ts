/** Turns repeated renderer/media readiness events into one presentation event. */
export function createPresentationReadyGate(onReady: () => void): () => void {
  let presented = false;
  return () => {
    if (presented) return;
    presented = true;
    onReady();
  };
}
