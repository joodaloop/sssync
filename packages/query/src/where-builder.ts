import type {
  ComparableField,
  ComparisonOperator,
  FieldValue,
  Scalar,
  ScalarField,
  ScalarFieldValue,
  StringField,
  WhereExpression,
} from './types'

export class WhereBuilder<TRow> {
  eq<TField extends ScalarField<TRow>>(
    field: TField,
    value: ScalarFieldValue<TRow, TField>,
  ): WhereExpression {
    return comparison('eq', field, value)
  }

  ne<TField extends ScalarField<TRow>>(
    field: TField,
    value: ScalarFieldValue<TRow, TField>,
  ): WhereExpression {
    return comparison('ne', field, value)
  }

  gt<TField extends ComparableField<TRow>>(
    field: TField,
    value: FieldValue<TRow, TField> & number,
  ): WhereExpression {
    return comparison('gt', field, value)
  }

  gte<TField extends ComparableField<TRow>>(
    field: TField,
    value: FieldValue<TRow, TField> & number,
  ): WhereExpression {
    return comparison('gte', field, value)
  }

  lt<TField extends ComparableField<TRow>>(
    field: TField,
    value: FieldValue<TRow, TField> & number,
  ): WhereExpression {
    return comparison('lt', field, value)
  }

  lte<TField extends ComparableField<TRow>>(
    field: TField,
    value: FieldValue<TRow, TField> & number,
  ): WhereExpression {
    return comparison('lte', field, value)
  }

  like<TField extends StringField<TRow>>(
    field: TField,
    value: string,
  ): WhereExpression {
    return comparison('like', field, value)
  }

  ilike<TField extends StringField<TRow>>(
    field: TField,
    value: string,
  ): WhereExpression {
    return comparison('ilike', field, value)
  }

  in<TField extends ScalarField<TRow>>(
    field: TField,
    value: readonly ScalarFieldValue<TRow, TField>[],
  ): WhereExpression {
    return comparison('in', field, value)
  }

  is<TField extends ScalarField<TRow>>(
    field: TField,
    value: ScalarFieldValue<TRow, TField> | null,
  ): WhereExpression {
    return comparison('is', field, value)
  }

  isNot<TField extends ScalarField<TRow>>(
    field: TField,
    value: ScalarFieldValue<TRow, TField> | null,
  ): WhereExpression {
    return comparison('isNot', field, value)
  }

  and(...expressions: readonly WhereExpression[]): WhereExpression {
    return { type: 'and', expressions }
  }

  or(...expressions: readonly WhereExpression[]): WhereExpression {
    return { type: 'or', expressions }
  }

  not(expression: WhereExpression): WhereExpression {
    return { type: 'not', expression }
  }
}

function comparison(
  op: ComparisonOperator,
  field: string,
  value: Scalar | readonly Scalar[],
): WhereExpression {
  return {
    type: 'comparison',
    op,
    field,
    value,
  }
}
