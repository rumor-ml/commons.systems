/**
 * Unit tests for framework extractors
 */

import { describe, test } from "node:test";
import assert from "node:assert";
import { GoExtractor } from "./go-extractor.js";
import { PlaywrightExtractor } from "./playwright-extractor.js";
import { GenericExtractor } from "./generic-extractor.js";
import { extractErrors, formatExtractionResult } from "./index.js";

describe("GoExtractor", () => {
  const extractor = new GoExtractor();

  describe("detect", () => {
    test("detects Go JSON output with high confidence", () => {
      const jsonOutput = `
{"Time":"2024-01-01T10:00:00Z","Action":"run","Package":"github.com/example/pkg","Test":"TestFoo"}
{"Time":"2024-01-01T10:00:01Z","Action":"output","Package":"github.com/example/pkg","Test":"TestFoo","Output":"=== RUN   TestFoo\\n"}
{"Time":"2024-01-01T10:00:02Z","Action":"fail","Package":"github.com/example/pkg","Test":"TestFoo"}
`;
      const result = extractor.detect(jsonOutput);
      assert.strictEqual(result?.framework, "go");
      assert.strictEqual(result?.confidence, "high");
      assert.strictEqual(result?.isJsonOutput, true);
    });

    test("detects Go text output with high confidence", () => {
      const textOutput = `
=== RUN   TestFoo
--- FAIL: TestFoo (0.01s)
    foo_test.go:42:
        Expected: 5
        Got: 3
FAIL
FAIL	github.com/example/pkg	0.012s
`;
      const result = extractor.detect(textOutput);
      assert.strictEqual(result?.framework, "go");
      assert.strictEqual(result?.confidence, "high");
      assert.strictEqual(result?.isJsonOutput, false);
    });

    test("returns null for non-Go output", () => {
      const output = "Some random log output\nNo Go markers here";
      const result = extractor.detect(output);
      assert.strictEqual(result, null);
    });
  });

  describe("extract - JSON", () => {
    test("extracts test failures from JSON output", () => {
      const jsonOutput = `
{"Time":"2024-01-01T10:00:00Z","Action":"run","Package":"github.com/example/pkg","Test":"TestFoo"}
{"Time":"2024-01-01T10:00:01Z","Action":"output","Package":"github.com/example/pkg","Test":"TestFoo","Output":"=== RUN   TestFoo\\n"}
{"Time":"2024-01-01T10:00:02Z","Action":"output","Package":"github.com/example/pkg","Test":"TestFoo","Output":"    foo_test.go:42:\\n"}
{"Time":"2024-01-01T10:00:03Z","Action":"output","Package":"github.com/example/pkg","Test":"TestFoo","Output":"        Expected: 5\\n"}
{"Time":"2024-01-01T10:00:04Z","Action":"output","Package":"github.com/example/pkg","Test":"TestFoo","Output":"        Got: 3\\n"}
{"Time":"2024-01-01T10:00:05Z","Action":"fail","Package":"github.com/example/pkg","Test":"TestFoo","Elapsed":0.01}
{"Time":"2024-01-01T10:00:06Z","Action":"run","Package":"github.com/example/pkg","Test":"TestBar"}
{"Time":"2024-01-01T10:00:07Z","Action":"pass","Package":"github.com/example/pkg","Test":"TestBar","Elapsed":0.001}
`;
      const result = extractor.extract(jsonOutput);

      assert.strictEqual(result.framework, "go");
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].testName, "TestFoo");
      assert.strictEqual(result.errors[0].fileName, "foo_test.go");
      assert.strictEqual(result.errors[0].lineNumber, 42);
      assert.ok(result.errors[0].message.includes("Expected: 5"));
      assert.strictEqual(result.summary, "1 failed, 1 passed");
    });
  });

  describe("extract - Text", () => {
    test("extracts test failures from text output", () => {
      const textOutput = `
=== RUN   TestFoo
--- FAIL: TestFoo (0.01s)
    foo_test.go:42:
        Expected: 5
        Got: 3
=== RUN   TestBar
--- PASS: TestBar (0.00s)
FAIL
FAIL	github.com/example/pkg	0.012s
`;
      const result = extractor.extract(textOutput);

      assert.strictEqual(result.framework, "go");
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].testName, "TestFoo");
      assert.strictEqual(result.errors[0].fileName, "foo_test.go");
      assert.strictEqual(result.errors[0].lineNumber, 42);
      assert.ok(result.errors[0].message.includes("Expected: 5"));
    });

    test("respects maxErrors limit", () => {
      const textOutput = `
--- FAIL: TestOne (0.01s)
    Error 1
--- FAIL: TestTwo (0.01s)
    Error 2
--- FAIL: TestThree (0.01s)
    Error 3
`;
      const result = extractor.extract(textOutput, 2);
      assert.strictEqual(result.errors.length, 2);
    });
  });
});

describe("PlaywrightExtractor", () => {
  const extractor = new PlaywrightExtractor();

  describe("detect", () => {
    test("detects Playwright output with high confidence", () => {
      const output = `
  ✓  1 [chromium] › example.spec.ts:10 › should pass
  ✘  2 [chromium] › example.spec.ts:20 › should fail
  ✓  3 [firefox] › other.spec.ts:15 › another test
`;
      const result = extractor.detect(output);
      assert.strictEqual(result?.framework, "playwright");
      assert.strictEqual(result?.confidence, "high");
      assert.strictEqual(result?.isJsonOutput, false);
    });

    test("returns null for non-Playwright output", () => {
      const output = "Some random log output\nNo Playwright markers";
      const result = extractor.detect(output);
      assert.strictEqual(result, null);
    });
  });

  describe("extract", () => {
    test("extracts test failures from Playwright output", () => {
      const output = `
Running 3 tests using 1 worker

  ✓  1 [chromium] › example.spec.ts:10 › should pass (500ms)
  ✘  2 [chromium] › example.spec.ts:20 › should fail (200ms)

    Error: expect(received).toBe(expected)

    Expected: "hello"
    Received: "world"

      18 |   test('should fail', async ({ page }) => {
      19 |     const text = await page.textContent('.greeting');
    > 20 |     expect(text).toBe('hello');
         |                  ^
      21 |   });

  ✓  3 [firefox] › other.spec.ts:15 › another test (300ms)

  1 failed
  2 passed
`;
      const result = extractor.extract(output);

      assert.strictEqual(result.framework, "playwright");
      assert.strictEqual(result.errors.length, 1);
      assert.strictEqual(result.errors[0].testName, "[chromium] should fail");
      assert.strictEqual(result.errors[0].fileName, "example.spec.ts");
      assert.strictEqual(result.errors[0].lineNumber, 20);
      assert.ok(result.errors[0].message.includes("expect(received).toBe(expected)"));
      assert.strictEqual(result.summary, "1 failed, 2 passed");
    });

    test("respects maxErrors limit", () => {
      const output = `
  ✘  1 [chromium] › test1.spec.ts:10 › fail 1
  ✘  2 [chromium] › test2.spec.ts:20 › fail 2
  ✘  3 [chromium] › test3.spec.ts:30 › fail 3
`;
      const result = extractor.extract(output, 2);
      assert.strictEqual(result.errors.length, 2);
    });
  });
});

describe("GenericExtractor", () => {
  const extractor = new GenericExtractor();

  describe("detect", () => {
    test("always returns low confidence", () => {
      const output = "Error: Something went wrong";
      const result = extractor.detect(output);
      assert.strictEqual(result?.framework, "generic");
      assert.strictEqual(result?.confidence, "low");
    });

    test("returns low confidence even with no patterns", () => {
      const output = "No errors here";
      const result = extractor.detect(output);
      assert.strictEqual(result?.framework, "generic");
      assert.strictEqual(result?.confidence, "low");
    });
  });

  describe("extract", () => {
    test("extracts errors using FAILURE_PATTERNS", () => {
      const output = `
Starting tests...
Running test suite...
Error: Connection timeout
    at connection.js:42
    Expected response within 5s
AssertionError: Values do not match
    Expected: true
    Got: false
All tests completed
`;
      const result = extractor.extract(output);

      assert.strictEqual(result.framework, "generic");
      assert.ok(result.errors.length >= 2);
      assert.ok(result.errors.some((e) => e.message.includes("Error: Connection timeout")));
      assert.ok(result.errors.some((e) => e.message.includes("AssertionError")));
    });

    test("extracts file:line references", () => {
      const output = `
Error: Something failed at test.js:42
Error: Another issue at main.go:123
`;
      const result = extractor.extract(output);

      assert.strictEqual(result.errors.length, 2);
      assert.strictEqual(result.errors[0].fileName, "test.js");
      assert.strictEqual(result.errors[0].lineNumber, 42);
      assert.strictEqual(result.errors[1].fileName, "main.go");
      assert.strictEqual(result.errors[1].lineNumber, 123);
    });

    test("returns empty errors when no patterns match", () => {
      const output = "All tests passed successfully";
      const result = extractor.extract(output);
      assert.strictEqual(result.errors.length, 0);
    });
  });
});

describe("extractErrors (orchestration)", () => {
  test("uses Go extractor for Go JSON output", () => {
    const jsonOutput = `
{"Time":"2024-01-01T10:00:00Z","Action":"run","Package":"pkg","Test":"TestFoo"}
{"Time":"2024-01-01T10:00:01Z","Action":"output","Package":"pkg","Test":"TestFoo","Output":"=== RUN TestFoo\\n"}
{"Time":"2024-01-01T10:00:02Z","Action":"fail","Package":"pkg","Test":"TestFoo"}
{"Time":"2024-01-01T10:00:03Z","Action":"run","Package":"pkg","Test":"TestBar"}
`;
    const result = extractErrors(jsonOutput);
    assert.strictEqual(result.framework, "go");
  });

  test("uses Go extractor for Go text output", () => {
    const textOutput = `
=== RUN   TestFoo
--- FAIL: TestFoo (0.01s)
    Expected: 5
    Got: 3
FAIL
`;
    const result = extractErrors(textOutput);
    assert.strictEqual(result.framework, "go");
  });

  test("uses Playwright extractor for Playwright output", () => {
    const output = `
Running 3 tests using 1 worker
  ✓  1 [chromium] › test1.spec.ts:10 › should pass
  ✘  2 [chromium] › test.spec.ts:10 › should fail
    Error: expect(received).toBe(expected)
  ✓  3 [firefox] › test2.spec.ts:15 › another test
`;
    const result = extractErrors(output);
    assert.strictEqual(result.framework, "playwright");
  });

  test("falls back to generic extractor for unknown output", () => {
    const output = `
Error: Unknown framework failure
Something went wrong
`;
    const result = extractErrors(output);
    assert.strictEqual(result.framework, "generic");
  });
});

describe("formatExtractionResult", () => {
  test("formats Go test failures", () => {
    const result = {
      framework: "go" as const,
      errors: [
        {
          testName: "TestFoo",
          fileName: "foo_test.go",
          lineNumber: 42,
          message: "Expected: 5\nGot: 3",
          context: [],
        },
      ],
    };

    const formatted = formatExtractionResult(result);
    assert.ok(formatted.some((line) => line.includes("--- FAIL: TestFoo")));
    assert.ok(formatted.some((line) => line.includes("foo_test.go:42")));
    assert.ok(formatted.some((line) => line.includes("Expected: 5")));
  });

  test("formats Playwright test failures", () => {
    const result = {
      framework: "playwright" as const,
      errors: [
        {
          testName: "[chromium] should fail",
          fileName: "test.spec.ts",
          lineNumber: 20,
          message: "Error: expect(received).toBe(expected)",
          context: [],
        },
      ],
    };

    const formatted = formatExtractionResult(result);
    assert.ok(formatted.some((line) => line.includes("--- FAIL: [chromium] should fail")));
    assert.ok(formatted.some((line) => line.includes("test.spec.ts:20")));
  });

  test("handles empty errors", () => {
    const result = {
      framework: "generic" as const,
      errors: [],
    };

    const formatted = formatExtractionResult(result);
    assert.deepStrictEqual(formatted, ["No errors detected"]);
  });

  test("handles errors without test names", () => {
    const result = {
      framework: "generic" as const,
      errors: [
        {
          message: "Error: Something went wrong",
          context: [],
        },
      ],
    };

    const formatted = formatExtractionResult(result);
    assert.ok(formatted.some((line) => line.includes("Error: Something went wrong")));
    assert.ok(!formatted.some((line) => line.includes("--- FAIL:")));
  });
});
