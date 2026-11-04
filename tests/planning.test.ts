import { describe, expect, it } from "vitest";
import { distribute, planGeneration, planTopUp } from "@/lib/ai/planning";
import { baseSettings, sampleDoc } from "./helpers";

describe("distribute", () => {
  it("sums to the total and respects caps", () => {
    const out = distribute(23, [1, 1, 1], 10);
    expect(out.reduce((a, b) => a + b, 0)).toBe(23);
    expect(Math.max(...out)).toBeLessThanOrEqual(10);
  });
});

describe("planGeneration", () => {
  it("splits a request into batches that add up to the requested count", () => {
    const doc = sampleDoc(30);
    const plan = planGeneration([doc], { ...baseSettings, questionCount: 50 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.batches.reduce((n, b) => n + b.count, 0)).toBe(50);
    expect(plan.batches.length).toBeGreaterThanOrEqual(5);
    for (const b of plan.batches) {
      expect(b.count).toBeLessThanOrEqual(15);
      expect(b.words).toBeLessThanOrEqual(5500 + 1600);
    }
  });
  it("refuses requests the material cannot support", () => {
    const plan = planGeneration([sampleDoc(1)], { ...baseSettings, questionCount: 100 });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.reason).toBe("insufficient");
    expect(plan.capacity).toBeGreaterThan(0);
    expect(plan.capacity).toBeLessThan(100);
  });
  it("restricts to selected sections", () => {
    const doc = sampleDoc(20);
    const target = doc.sections[1];
    const plan = planGeneration([doc], { ...baseSettings, sourceMode: "sections", sectionIds: [target.id], questionCount: 10 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const labels = new Set(plan.batches.flatMap((b) => b.chunks.map((c) => c.label)));
    expect([...labels]).toEqual([target.title]);
  });
  it("selects only chunks relevant to a custom topic", () => {
    const doc = sampleDoc(20);
    const plan = planGeneration([doc], { ...baseSettings, sourceMode: "topic", topic: "page table paging", questionCount: 10 });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    for (const b of plan.batches) for (const c of b.chunks) expect(c.label).toBe("Chapter 3: Memory Management");
  });
  it("reports a topic that is not in the material", () => {
    const plan = planGeneration([sampleDoc(5)], { ...baseSettings, sourceMode: "topic", topic: "photosynthesis" });
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe("topic-not-found");
  });
  it("plans top-up batches for a shortfall", () => {
    const plan = planGeneration([sampleDoc(30)], { ...baseSettings, questionCount: 30 });
    if (!plan.ok) throw new Error("plan failed");
    const top = planTopUp(plan.batches, { b1: 10, b2: 2, b3: 10 }, 7, 1);
    expect(top.reduce((n, b) => n + b.count, 0)).toBe(7);
    expect(top[0].chunkIds).toEqual(plan.batches[1].chunkIds);
  });
});
