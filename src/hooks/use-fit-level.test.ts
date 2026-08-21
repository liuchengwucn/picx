import { describe, expect, it } from "vitest";
import { nextFitLevel } from "./use-fit-level";

describe("nextFitLevel", () => {
  it("有余量且没到顶就升一档", () => {
    expect(nextFitLevel(200, 0, 4)).toEqual({ level: 1, done: false });
    expect(nextFitLevel(200, 3, 4)).toEqual({ level: 4, done: false });
  });

  it("到顶就停在原档", () => {
    expect(nextFitLevel(200, 4, 4)).toEqual({ level: 4, done: true });
  });

  it("升过头(余量被吃成 0)退回一档并停", () => {
    expect(nextFitLevel(0, 2, 4)).toEqual({ level: 1, done: true });
  });

  it("level 0 就没余量时停在 0, 不退到 -1", () => {
    expect(nextFitLevel(0, 0, 4)).toEqual({ level: 0, done: true });
  });

  it("level 0 就溢出(极端窄屏)同样停在 0", () => {
    expect(nextFitLevel(-40, 0, 4)).toEqual({ level: 0, done: true });
  });

  it("余量不足 MIN_SLACK 时不做无谓的试探", () => {
    expect(nextFitLevel(8, 1, 4)).toEqual({ level: 0, done: true });
  });

  it("maxLevel 为 0 时永远不升档", () => {
    expect(nextFitLevel(500, 0, 0)).toEqual({ level: 0, done: true });
  });
});
