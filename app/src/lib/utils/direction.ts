/** 向きを反転する (begin/end を入れ替えたときに使う) */
export function flipDirection(direction: App.TravelDirection): App.TravelDirection {
  switch (direction) {
    case "forward":
      return "backward";
    case "backward":
      return "forward";
    default:
      return direction;
  }
}

/**
 * 2 本のエッジを「a → b」の順に連結したときの向き。
 * 成分ごとの AND をとるため、連結方向に対して両方が通行可能なときだけ通行可能になる。
 */
export function combineDirection(a: App.TravelDirection, b: App.TravelDirection): App.TravelDirection {
  const forward = canTraverseForward(a) && canTraverseForward(b);
  const backward = canTraverseBackward(a) && canTraverseBackward(b);
  if (forward && backward) return "both";
  if (forward) return "forward";
  if (backward) return "backward";
  return "none";
}

/** begin → end の向きに進めるか */
export function canTraverseForward(direction: App.TravelDirection): boolean {
  return direction === "both" || direction === "forward";
}

/** end → begin の向きに進めるか */
export function canTraverseBackward(direction: App.TravelDirection): boolean {
  return direction === "both" || direction === "backward";
}
