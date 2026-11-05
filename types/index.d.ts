// A compaction Claude asked for once it recorded the state in files (the
// starting point first).
export type SelfCompactPending = {
  records: string[]
  instructions?: string
  // A note added to the resume prompt that follows every compaction.
  resume?: string
  // Set once turn.complete queued /compact (and the resume prompt) for it.
  isQueued?: true
}

declare module 'claude-code' {
  interface PluginState {
    'smart-autocompact': {
      pending: SelfCompactPending | null
      // The highest context mark (in tokens) already announced; 0 after a compaction.
      lastMark: number
    }
  }
}
