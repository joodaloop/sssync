import type {Change} from '../../packages/zql/src/ivm/change.ts';
import type {SourceChange} from '../../packages/zql/src/ivm/source.ts';

export type ChangeListener = (change: Change) => void;

export type Unsubscribe = () => void;

export type TableChange = {
  tableName: string;
  change: SourceChange;
};
