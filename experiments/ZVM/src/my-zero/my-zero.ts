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
import {hydrateFromSQLite} from './hydrate.ts';
import type {ChangeListener, Unsubscribe} from './types.ts';

type HydrationEvent = {
  tableName: string;
  queryHash: string;
  sql: string;
  values: readonly unknown[];
  rowCount: number;
};

export class MyZero<TSchema extends Schema> {
  readonly #schema: TSchema;
  readonly #delegate: MyZeroDelegate<TSchema>;
  readonly #hydrationListeners = new Set<(event: HydrationEvent) => void>();
  readonly #hydratedQueryHashes = new Set<string>();
  readonly #hydratingQueries = new Map<string, Promise<void>>();
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
    const source = this.#delegate.requireSource(tableName);
    for (const row of rows) {
      if (source.data.has(row)) {
        continue;
      }
      this.ingest(tableName, {type: 'add', row});
    }
  }

  ingest<TTable extends keyof TSchema['tables'] & string>(
    tableName: TTable,
    change: SourceChange,
  ): void {
    const source = this.#delegate.requireSource(tableName);
    consume(source.push(change));
    this.#delegate.fireCommit();
  }

  query() {
    return createBuilder(this.#schema);
  }

  onHydrated(listener: (event: HydrationEvent) => void): Unsubscribe {
    this.#hydrationListeners.add(listener);
    return () => {
      this.#hydrationListeners.delete(listener);
    };
  }

  #notifyHydrated(event: HydrationEvent): void {
    for (const listener of this.#hydrationListeners) {
      listener(event);
    }
  }

  #ensureHydrated<
    TTable extends keyof TSchema['tables'] & string,
    TReturn,
  >(query: Query<TTable, TSchema, TReturn>): Promise<void> {
    const internals = asQueryInternals(query);
    const queryHash = internals.hash();
    if (this.#hydratedQueryHashes.has(queryHash)) {
      return Promise.resolve();
    }

    const inFlightHydration = this.#hydratingQueries.get(queryHash);
    if (inFlightHydration) {
      return inFlightHydration;
    }

    const hydration = hydrateFromSQLite(
      this,
      internals.ast.table as TTable,
      query,
      this.#schema,
    )
      .then(result => {
        this.#hydratedQueryHashes.add(queryHash);
        this.#notifyHydrated({
          tableName: internals.ast.table,
          queryHash,
          sql: result.sql,
          values: result.values,
          rowCount: result.rowCount,
        });
      })
      .finally(() => {
        this.#hydratingQueries.delete(queryHash);
      });

    this.#hydratingQueries.set(queryHash, hydration);
    return hydration;
  }

  materialize<
    TTable extends keyof TSchema['tables'] & string,
    TReturn,
  >(query: Query<TTable, TSchema, TReturn>): TypedView<HumanReadable<TReturn>> {
    const view = this.#delegate.materialize(query);
    void this.#ensureHydrated(query).catch(error => {
      console.error('Auto-hydration failed:', error);
    });
    return view;
  }

  subscribeChanges<
    TTable extends keyof TSchema['tables'] & string,
    TReturn,
  >(
    query: Query<TTable, TSchema, TReturn>,
    listener: ChangeListener,
  ): Unsubscribe {
    void this.#ensureHydrated(query).catch(error => {
      console.error('Auto-hydration failed:', error);
    });
    const internals = asQueryInternals(query);
    const queryID = `${internals.hash()}:${this.#subscriptionCount++}`;
    const input = buildPipeline(internals.ast, this.#delegate, queryID);
    const sink = new ChangeSink(input, listener);
    return () => {
      sink.destroy();
    };
  }
}
