import type { Store } from '../store/types'
import type { MockSchema } from './mock-schema'

export type MockStore = Store<MockSchema> & { applied: unknown[] }

export function createMockStore(): MockStore {
  const applied: unknown[] = []
  return {
    applied,
    apply(ops) {
      applied.push(ops)
    },
  }
}
