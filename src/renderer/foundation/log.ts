export function frontendLog(enabled: boolean, ...args: unknown[]): void {
  if (!enabled) return;
  console.debug('[empaquetar]', ...args);
}
