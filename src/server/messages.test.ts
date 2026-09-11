import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { inspect } from "./fields.ts";
import { audioForText, SAY } from "../shared/messages.ts";

test("every voiced message resolves to its own recording", () => {
  for (const [key, spoken] of Object.entries(SAY))
    assert.equal(
      audioForText(spoken.text),
      spoken.recorded ? spoken.audio : null,
      `${key} did not resolve`,
    );
});

test("every recording the bot would send actually exists", () => {
  // A missing file 404s and the player quietly removes itself, so the rider is
  // left with a silent gap. Catch it here instead.
  const dir = new URL("../../public/", import.meta.url);
  for (const [key, spoken] of Object.entries(SAY)) {
    if (!spoken.recorded) continue;
    for (const ext of [".opus", ".m4a"])
      assert.ok(
        existsSync(new URL(`.${spoken.audio}${ext}`, dir)),
        `${key} promises ${spoken.audio}${ext}, which is not in public/`,
      );
  }
});

test("an unrecognised line has no recording", () => {
  assert.equal(audioForText("Shukriya, tasveer mil gayi."), null);
  assert.equal(audioForText(""), null);
});

test("the refusals the document rules emit are in the lookup", () => {
  // A reading with nothing in it fails every document kind, which is the path
  // that produces the per-document refusals.
  const empty = { lines: [], words: [] };
  for (const kind of ["cnic_front", "cnic_back", "license", "bill"] as const) {
    const reason = inspect(kind, empty).reason;
    assert.ok(reason, `${kind} produced no reason`);
    assert.ok(
      audioForText(reason),
      `${kind} reason is not in the lookup: ${reason}`,
    );
  }
});
