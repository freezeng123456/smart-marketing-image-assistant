import test from "node:test";
import assert from "node:assert/strict";
import {
  validateMarketingPrompt,
  deriveTitle,
  uniqueBy
} from "../src/utils.js";

test("empty prompt is rejected with the required copy", () => {
  const result = validateMarketingPrompt("   ");
  assert.equal(result.ok, false);
  assert.equal(result.message, "请先描述你想生成的营销素材。");
});

test("normal marketing prompt is preserved", () => {
  const prompt = "生成一张七夕主题的袋鼠活动海报，竖版 1080x1920，预留优惠信息区域。";
  assert.equal(validateMarketingPrompt(prompt).ok, true);
  assert.equal(deriveTitle(prompt).includes("七夕"), true);
});

test("brand destructive request is blocked", () => {
  const result = validateMarketingPrompt("删除品牌袋鼠并替换品牌IP");
  assert.equal(result.ok, false);
  assert.equal(result.kind, "brand");
});

test("uniqueBy keeps the first item for each key", () => {
  assert.deepEqual(
    uniqueBy([{ id: 1 }, { id: 1 }, { id: 2 }], (item) => item.id),
    [{ id: 1 }, { id: 2 }]
  );
});
