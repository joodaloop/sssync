import type { ChangeListener, QueryNodeSnapshot, RuntimeRow } from '../types'
import type { QueryNode } from './query-node'

export class QueryPipeline {
  readonly #nodes: QueryNode[]

  constructor(nodes: QueryNode[]) {
    this.#nodes = nodes
  }

  output(): QueryNode {
    return this.#nodes[this.#nodes.length - 1]
  }

  rows(): readonly RuntimeRow[] {
    return this.output().rows()
  }

  nodes(): readonly QueryNodeSnapshot[] {
    return this.#nodes.map(node => node.snapshot())
  }

  subscribe(listener: ChangeListener<RuntimeRow>): () => void {
    return this.output().subscribe(listener)
  }

  dispose() {
    for (const node of this.#nodes) {
      node.dispose()
    }
  }
}
