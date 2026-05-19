export class LeaderElection {
  private lockName: string
  private isLeaderState = false
  private listeners: Set<(isLeader: boolean) => void> = new Set()

  constructor(lockName = 'sssync-leader') {
    this.lockName = lockName
  }

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'locks' in navigator
  }

  isLeader(): boolean {
    return this.isLeaderState
  }

  onLeadershipChange(callback: (isLeader: boolean) => void): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  requestLeadership(): void {
    if (!LeaderElection.isSupported()) return

    navigator.locks
      .request(this.lockName, { mode: 'exclusive' }, () => {
        this.setLeader(true)
        return new Promise<void>(() => {})
      })
      .catch((error) => {
        console.warn('Leader election request failed:', error)
      })
  }

  private setLeader(isLeader: boolean): void {
    if (this.isLeaderState === isLeader) return
    this.isLeaderState = isLeader
    for (const listener of this.listeners) {
      try {
        listener(isLeader)
      } catch (error) {
        console.warn('Leadership change listener error:', error)
      }
    }
  }
}
