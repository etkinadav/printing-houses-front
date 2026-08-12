import {
  computeDynamicMockupAspectSplit,
  mapPrintRectToCollapsedAspectLayout,
  buildDynamicMockupAdjustedPrintRectNorm,
  collapsedAspectLayoutSpanNorm,
} from './ph-print-mockup-dynamic-aspect.util';

describe('computeDynamicMockupAspectSplit', () => {
  it('returns null when aspects match', () => {
    expect(
      computeDynamicMockupAspectSplit(
        { x: 0.1, y: 0.1, width: 0.2, height: 0.5 },
        50,
        50,
        400,
        400,
      ),
    ).toBeNull();
  });

  it('horizontal band for 100x50 preview on 200x500 print px (user example)', () => {
    const split = computeDynamicMockupAspectSplit(
      { x: 0, y: 0, width: 1, height: 1 },
      100,
      50,
      200,
      500,
    );
    expect(split?.lineOrientation).toBe('horizontal');
    expect(split?.bandHalfPx).toBe(200);
    expect(split?.lineCenterNorm).toBe(0.5);
    expect(split?.bandLineNearNorm).toBe(0.1);
    expect(split?.bandLineFarNorm).toBe(0.9);
  });

  it('vertical band for taller/narrower preview', () => {
    const split = computeDynamicMockupAspectSplit(
      { x: 0, y: 0, width: 0.5, height: 0.2 },
      20,
      60,
      500,
      200,
    );
    expect(split?.lineOrientation).toBe('vertical');
    expect(split?.bandHalfPx).toBeGreaterThan(0);
    expect(split!.bandLineFarNorm - split!.bandLineNearNorm).toBeCloseTo(
      (split!.bandHalfPx * 2) / 500,
    );
  });

  it('maps adjusted print rect into collapsed rejoined layout', () => {
    const split = computeDynamicMockupAspectSplit(
      { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      100,
      50,
      200,
      500,
    );
    expect(split).toBeTruthy();
    const adjusted = buildDynamicMockupAdjustedPrintRectNorm(split!, {
      x: 0.1,
      y: 0.1,
      width: 0.8,
      height: 0.8,
    });
    const collapsed = mapPrintRectToCollapsedAspectLayout(split!, adjusted);
    const span = collapsedAspectLayoutSpanNorm(split!);
    expect(collapsed.y).toBeCloseTo(0.1 / span);
    expect(collapsed.height).toBeCloseTo(adjusted.height / span);
    expect(collapsed.y + collapsed.height).toBeLessThanOrEqual(1.0001);
  });
});
