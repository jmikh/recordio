import { calculateZoomSchedule, VideoMappingConfig } from './cameraMotion';
import type { ZoomConfig, UserEvent } from '../types';

function assertStrictEqual(a: any, b: any, msg?: string) {
    if (a !== b) {
        throw new Error(msg || `Expected ${a} === ${b}`);
    }
}
function assertDeepStrictEqual(a: any, b: any, msg?: string) {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
        throw new Error(msg || `Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
    }
}

const assert = {
    strictEqual: assertStrictEqual,
    deepStrictEqual: assertDeepStrictEqual
};

// Setup Scenario based on User Request
const outputVideoWidth = 1000;
const outputVideoHeight = 1000;
const inputVideoWidth = 2000;
const inputVideoHeight = 2000;
const zoom = 2;

// Events
const events: UserEvent[] = [
    {
        type: 'click',
        timestamp: 1000,
        x: 0, y: 0,
    },
    {
        type: 'click',
        timestamp: 3000,
        x: inputVideoWidth / 2, y: inputVideoHeight / 2,
    },
    {
        type: 'click',
        timestamp: 5000,
        x: inputVideoWidth, y: inputVideoHeight,
    }
];

function runTest(paddingPercentage: number, scenarioName: string) {
    console.log(`\n=== Running Scenario: ${scenarioName} (Padding: ${paddingPercentage}) ===`);

    const mappingConfig = new VideoMappingConfig(
        { width: inputVideoWidth, height: inputVideoHeight }, // input
        { width: outputVideoWidth, height: outputVideoHeight }, // output
        paddingPercentage
    );

    const config: ZoomConfig = {
        zoomIntensity: zoom,
        zoomDuration: 0,
        zoomOffset: 0
    };

    console.log("Running Zoom Schedule Calculation...");
    const schedule = calculateZoomSchedule(config, mappingConfig, events);

    console.log("--- Generated Schedule ---");
    schedule.forEach((k, i) => {
        console.log(`Motion #${i}: timeOut=${k.timeOutMs}`);
        console.log(`  Target: x=${k.target.x}, y=${k.target.y}, w=${k.target.width}, h=${k.target.height}`);
    });

    console.log("--- Running Assertions ---");

    assert.strictEqual(schedule.length, 3, "Should have 3 motions (1 per Click)");

    if (paddingPercentage === 0) {
        // --- NO PADDING CASE (Standard) ---

        // Motion 0: Top Left Click (0,0) -> Output (0,0)
        // Box TopLeft: -250 -> Clamped to 0.
        assert.strictEqual(schedule[0].target.x, 0, "M0 X incorrect");
        assert.strictEqual(schedule[0].target.y, 0, "M0 Y incorrect");

        // Motion 1: Center Click (1000,1000) -> Output (500,500)
        // Box TopLeft: 500 - 250 = 250.
        assert.strictEqual(schedule[1].target.x, 250, "M1 X incorrect");
        assert.strictEqual(schedule[1].target.y, 250, "M1 Y incorrect");

        // Motion 2: Bottom Right Click (2000,2000) -> Output (1000,1000)
        // Box TopLeft: 1000 - 250 = 750.
        // Clamped MaxX = 1000 - 500 = 500.
        assert.strictEqual(schedule[2].target.x, 500, "M2 X incorrect");
        assert.strictEqual(schedule[2].target.y, 500, "M2 Y incorrect");

    } else if (paddingPercentage === 0.1) {
        // --- PADDING CASE (10%) ---
        // Video Rect: x=100, y=100, w=800, h=800.
        // Scale: 2000 / 800 = 2.5.

        // Motion 0: Top Left Click (0,0) -> Output (100, 100)
        // Box TopLeft: 100 - 250 = -150.
        // Clamped to 0.
        // Wait!
        // X: 100. Center=100. BoxW=500. TopLeft=100-250 = -150. Clamped to 0?
        // Logic: Math.max(0, Math.min(-150, 1000-500)).
        // -150 < 0 => 0. Correct.
        assert.strictEqual(schedule[0].target.x, 0, "M0 X incorrect");
        assert.strictEqual(schedule[0].target.y, 0, "M0 Y incorrect");

        // Motion 1: Center Click (1000,1000) -> Output (100 + 400, 100 + 400) = (500, 500)
        // Box TopLeft: 500 - 250 = 250.
        assert.strictEqual(schedule[1].target.x, 250, "M1 X incorrect");
        assert.strictEqual(schedule[1].target.y, 250, "M1 Y incorrect");

        // Motion 2: Bottom Right Click (2000,2000) -> Output (100 + 800, 100 + 800) = (900, 900)
        // Box TopLeft: 900 - 250 = 650.
        // MaxX = 500.
        // 650 > 500 => 500.
        assert.strictEqual(schedule[2].target.x, 500, "M2 X incorrect");
        assert.strictEqual(schedule[2].target.y, 500, "M2 Y incorrect");

        // Test Bounding Box Projection for Padding Case
        console.log("--- Testing Bounding Box Projection (Padding) ---");
        const testRect = { x: 500, y: 500, width: 100, height: 100 };
        // Input 500 -> Output?
        // OutputX = 100 + 500/2.5 = 100 + 200 = 300.
        // Width = 100/2.5 = 40.
        const projectedRect = mappingConfig.projectInputToOutputRect(testRect);
        assert.strictEqual(projectedRect.x, 300, "Rect X incorrect");
        assert.strictEqual(projectedRect.y, 300, "Rect Y incorrect");
        assert.strictEqual(projectedRect.width, 40, "Rect Width incorrect");
        assert.strictEqual(projectedRect.height, 40, "Rect Height incorrect");
    }

    // Common Width/Height Assertions
    for (let i = 0; i < 3; i++) {
        assert.strictEqual(schedule[i].target.width, 500, `M${i} Width incorrect`);
        assert.strictEqual(schedule[i].target.height, 500, `M${i} Height incorrect`);
    }
    console.log("  ✅ Verified ZoomBox Dimensions (500x500)");

    console.log(`✅ Scenario '${scenarioName}' Passed!`);
}

// Run Scenarios
runTest(0, "No Padding");
runTest(0.1, "10% Padding");

console.log("\n✅✅ All Scenarios Passed! ✅✅");
