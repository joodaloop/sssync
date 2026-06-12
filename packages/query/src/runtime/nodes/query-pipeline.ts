import type { ChangeListener, QueryNodeSnapshot, RuntimeRow } from '../types'
import type { QueryNode } from './query-node'

export class QueryPipeline<TRow = unknown> {
  readonly #nodes: QueryNode[]

  constructor(nodes: QueryNode[]) {
    this.#nodes = nodes
  }

  output(): QueryNode {
    return this.#nodes[this.#nodes.length - 1]
  }

  rows(): readonly TRow[] {
    return this.output().rows() as TRow[]
  }

  nodes(): readonly QueryNodeSnapshot[] {
    return this.#nodes.map(node => node.snapshot())
  }

  subscribe(listener: ChangeListener<TRow>): () => void {
    return this.output().subscribe(listener as ChangeListener<RuntimeRow>)
  }

  dispose() {
    for (const node of this.#nodes) {
      node.dispose()
    }
  }
}
