import type { Scalar, WhereExpression } from './types'

export function evaluateWhere(
  expression: WhereExpression,
  row: Record<string, unknown>,
): boolean {
  switch (expression.type) {
    case 'comparison':
      return evaluateComparison(
        expression.op,
        row[expression.field],
        expression.value,
      )
    case 'and':
      return expression.expressions.every(expr => evaluateWhere(expr, row))
    case 'or':
      return expression.expressions.some(expr => evaluateWhere(expr, row))
    case 'not':
      return !evaluateWhere(expression.expression, row)
  }
}

function evaluateComparison(
  op: string,
  left: unknown,
  right: Scalar | readonly Scalar[],
): boolean {
  switch (op) {
    case 'eq':
      return left === right
    case 'ne':
      return left !== right
    case 'gt':
      return typeof left === 'number' && typeof right === 'number' && left > right
    case 'gte':
      return typeof left === 'number' && typeof right === 'number' && left >= right
    case 'lt':
      return typeof left === 'number' && typeof right === 'number' && left < right
    case 'lte':
      return typeof left === 'number' && typeof right === 'number' && left <= right
    case 'like':
      return typeof left === 'string' && like(left, String(right), false)
    case 'ilike':
      return typeof left === 'string' && like(left, String(right), true)
    case 'in':
      return Array.isArray(right) && isScalar(left) && right.includes(left)
    case 'is':
      return left === right
    case 'isNot':
      return left !== right
    default:
      return false
  }
}

function isScalar(value: unknown): value is Scalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function like(value: string, pattern: string, caseInsensitive: boolean): boolean {
  const source = caseInsensitive ? value.toLocaleLowerCase() : value
  const expected = caseInsensitive ? pattern.toLocaleLowerCase() : pattern
  const escaped = expected.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`^${escaped.replaceAll('%', '.*').replaceAll('_', '.')}$`)
  return regex.test(source)
}
