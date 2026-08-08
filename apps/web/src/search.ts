export function fuzzyTitleMatch(title: string, query: string): boolean {
  const candidates = [title, ...title.split(/\s+/)].filter(Boolean);
  return candidates.some((candidate) => {
    if (
      Math.abs(candidate.length - query.length) >
      Math.max(2, Math.floor(query.length / 3))
    )
      return false;
    const previous = Array.from(
      { length: query.length + 1 },
      (_, index) => index,
    );
    for (let row = 1; row <= candidate.length; row += 1) {
      const current = [row];
      for (let column = 1; column <= query.length; column += 1)
        current[column] = Math.min(
          (current[column - 1] ?? 0) + 1,
          (previous[column] ?? 0) + 1,
          (previous[column - 1] ?? 0) +
            (candidate[row - 1] === query[column - 1] ? 0 : 1),
        );
      previous.splice(0, previous.length, ...current);
    }
    return (
      (previous[query.length] ?? Infinity) <=
      Math.max(1, Math.floor(query.length / 3))
    );
  });
}
