/**
 * NTP-style Clock Synchronizer
 * Calculates the offset between client clock and server clock using round-trip latency.
 */
export class ClockSynchronizer {
  private offsetSamples: number[] = [];
  private lastRtt: number = 0;
  private currentOffset: number = 0;
  private maxSamples: number = 5;

  /**
   * Called when TIME_SYNC_REPLY is received from server.
   * @param t1 Client timestamp when ping was sent
   * @param serverTime Server timestamp when ping was received/replied
   * @param t4 Client timestamp when reply was received (defaults to Date.now())
   */
  public handleSyncReply(t1: number, serverTime: number, t4: number = Date.now()): void {
    const rtt = Math.max(0, t4 - t1);
    this.lastRtt = rtt;

    // Offset = serverTime - (t1 + t4) / 2
    const oneWayDelay = rtt / 2;
    const estimatedServerAtT4 = serverTime + oneWayDelay;
    const sampleOffset = estimatedServerAtT4 - t4;

    this.offsetSamples.push(sampleOffset);
    if (this.offsetSamples.length > this.maxSamples) {
      this.offsetSamples.shift();
    }

    // Use median of recent samples to eliminate outliers
    const sorted = [...this.offsetSamples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    this.currentOffset = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  /**
   * Returns current estimated server epoch timestamp in milliseconds.
   */
  public getEstimatedServerTime(): number {
    return Date.now() + this.currentOffset;
  }

  public getOffset(): number {
    return this.currentOffset;
  }

  public getLastRtt(): number {
    return this.lastRtt;
  }

  public reset(): void {
    this.offsetSamples = [];
    this.lastRtt = 0;
    this.currentOffset = 0;
  }
}
