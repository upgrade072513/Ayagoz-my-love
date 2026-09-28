export function createLatestPeriodRunner(
  generate: (period: string) => Promise<unknown>
) {
  let version = 0;
  return async (period: string, onLatest: () => void) => {
    const requestVersion = ++version;
    await generate(period);
    if (requestVersion === version) onLatest();
  };
}
