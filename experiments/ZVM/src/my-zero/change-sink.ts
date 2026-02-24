export const emptyArray = Object.freeze([]);
import type { Change } from "../../packages/zql/src/ivm/change.ts";
import { skipYields, type Input, type InputBase, type Output } from "../../packages/zql/src/ivm/operator.ts";
import type { Stream } from "../../packages/zql/src/ivm/stream.ts";
import type { ChangeListener } from "./types.ts";

export class ChangeSink implements Output {
  readonly #input: Input;
  readonly #listener: ChangeListener;

  constructor(input: Input, listener: ChangeListener) {
    this.#input = input;
    this.#listener = listener;
    this.#input.setOutput(this);
    this.#emitInitialRows();
  }

  #emitInitialRows() {
    for (const node of skipYields(this.#input.fetch({}))) {
      this.#listener({ type: "add", node });
    }
  }

  push(change: Change, _pusher: InputBase): Stream<"yield"> {
    this.#listener(change);
    return emptyArray;
  }

  destroy() {
    this.#input.destroy();
  }
}
