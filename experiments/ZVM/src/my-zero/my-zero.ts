import type {Row} from '../../packages/zero-protocol/src/data.ts';
import type {Schema} from '../../packages/zero-types/src/schema.ts';
import {buildPipeline} from '../../packages/zql/src/builder/builder.ts';
import {consume} from '../../packages/zql/src/ivm/stream.ts';
import type {SourceChange} from '../../packages/zql/src/ivm/source.ts';
import {createBuilder} from '../../packages/zql/src/query/create-builder.ts';
import {asQueryInternals} from '../../packages/zql/src/query/query-internals.ts';
import type {HumanReadable} from '../../packages/zql/src/query/query.ts';
import type {Query} from '../../packages/zql/src/query/query.ts';
import type {TypedView} from '../../packages/zql/src/query/typed-view.ts';
import {ChangeSink} from './change-sink.ts';
import {MyZeroDelegate} from './delegate.ts';
import type {ChangeListener, Unsubscribe} from './types.ts';

export class MyZero<TSchema extends Schema> {
  readonly #schema: TSchema;
  readonly #delegate: MyZeroDelegate<TSchema>;
  #subscriptionCount = 0;

  constructor(schema: TSchema) {
    this.#schema = schema;
    this.#delegate = new MyZeroDelegate(schema);
  }

  registerTable<TTable extends keyof TSchema['tables'] & string>(
    tableName: TTable,
  ) {
    return this.#delegate.requireSource(tableName);
  }

  seed<TTable extends keyof TSchema['tables'] & string>(
    tableName: TTable,
    rows: readonly Row[],
  ): void {
    for (const row of rows) {
      this.ingest(tableName, {type: 'add', row});
    }
  }

  ingest<TTable extends keyof TSchema['tables'] & string>(
    tableName: TTable,
    change: SourceChange,
  ): void {
    const source = this.#delegate.requireSource(tableName);
    consume(source.push(change));
  }

  query() {
    return createBuilder(this.#schema);
  }

  materialize<
    TTable extends keyof TSchema['tables'] & string,
    TReturn,
  >(query: Query<TTable, TSchema, TReturn>): TypedView<HumanReadable<TReturn>> {
    return this.#delegate.materialize(query);
  }

  subscribeChanges<
    TTable extends keyof TSchema['tables'] & string,
    TReturn,
  >(
    query: Query<TTable, TSchema, TReturn>,
    listener: ChangeListener,
  ): Unsubscribe {
    const internals = asQueryInternals(query);
    const queryID = `${internals.hash()}:${this.#subscriptionCount++}`;
    const input = buildPipeline(internals.ast, this.#delegate, queryID);
    const sink = new ChangeSink(input, listener);
    return () => {
      sink.destroy();
    };
  }
}
