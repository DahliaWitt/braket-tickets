function clamp(value: number, [min, max]: [number, number]): number {
  return Math.min(max, Math.max(min, value));
}

function roundToStep(value: number, min: number, step: number): number {
  return Math.round((value - min) / step) * step + min;
}

/**
 * Rounds `value` to the nearest step, then clamps the result into `[min, max]`.
 *
 * Plain {@link roundToStep} has no upper bound: when `(max - min)` is not an
 * exact multiple of `step`, rounding the top of the range can produce a value
 * above `max` (e.g. min=0, max=10, step=4 → round(10) = 12). Sliders must never
 * emit a value outside `[min, max]`, so every slider code path rounds through
 * this helper instead of raw `roundToStep`.
 */
function roundToStepClamped(
  value: number,
  min: number,
  max: number,
  step: number,
): number {
  return clamp(roundToStep(value, min, step), [min, max]);
}

function convertValueToPercentage(
  value: number,
  min: number,
  max: number,
): number {
  return ((value - min) / (max - min)) * 100;
}

export {clamp, roundToStep, roundToStepClamped, convertValueToPercentage};
