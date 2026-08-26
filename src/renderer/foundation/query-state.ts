export type QueryState = 'idle' | 'loading' | 'success' | 'error' | 'empty';

export function queryStateFrom(input: { loading: boolean; error?: unknown; empty?: boolean; hasData?: boolean }): QueryState {
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  if (input.empty || input.hasData === false) return 'empty';
  if (input.hasData) return 'success';
  return 'idle';
}
