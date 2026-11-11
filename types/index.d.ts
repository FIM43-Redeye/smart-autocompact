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

// The records of the last compaction Claude prepared, kept so a later
// compaction nobody prepared for can still point back at them.
export type SelfCompactRecorded = {
  records: string[]
  // When that compaction ran, in ms since the epoch.
  at: number
}

// The session's auto-compaction point as last read, so the marks can follow
// it without a usage breakdown on every tool call.
export type SelfCompactThreshold = {
  // Absent when auto-compaction is off or the point could not be read.
  tokens?: number
  // When it was read, in ms since the epoch.
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'smart-autocompact': {
      pending: SelfCompactPending | null
      // The highest context mark (in tokens) already announced; 0 after a compaction.
      lastMark: number
      lastRecorded: SelfCompactRecorded | null
      threshold: SelfCompactThreshold | null
    }
  }
}
