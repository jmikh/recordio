import { calculateZoomSchedule, ViewTransform } from './cameraMotion';
import type { UserEvent } from '../types';

function assertStrictEqual(a: any, b: any, msg?: string) {
    if (a !== b) {
        throw new Error(msg || `Expected ${a} === ${b}`);
    }
}

const assert = {
    strictEqual: assertStrictEqual
};

// Setup Scenario based on User Request
// Logic is now Source Space based, so Output Dimensions don't affect the Schedule values.
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

function runTest(scenarioName: string) {
    console.log(`\n=== Running Scenario: ${scenarioName} ===`);

    const mappingConfig = new ViewTransform(
        { width: inputVideoWidth, height: inputVideoHeight }, // input
        { width: outputVideoWidth, height: outputVideoHeight }, // output
        0 // Padding irrelevant for Source Calculation
    );

    console.log("Running Zoom Schedule Calculation...");
    const schedule = calculateZoomSchedule(zoom, mappingConfig, events);

    console.log("--- Generated Schedule ---");
    schedule.forEach((k, i) => {
        console.log(`Motion #${i}: timeOut=${k.timeOutMs}`);
        console.log(`  Target: x=${k.cameraWindow.x}, y=${k.cameraWindow.y}, w=${k.cameraWindow.width}, h=${k.cameraWindow.height}`);
    });

    console.log("--- Running Assertions ---");

    // We expect 4 motions:
    // 0: Zoom In (Click 1)
    // 1: Zoom In (Click 2)
    // 2: Zoom In (Click 3)
    // 3: Zoom Out (End of sequence)
    assert.strictEqual(schedule.length, 4, "Should have 4 motions");

    // Target Box Size Calculation (Output Space):
    // Output 1000. Zoom 2. Target Size = 500.
    const expectedSize = 500;

    // Verify Sizes
    for (let i = 0; i < 3; i++) {
        assert.strictEqual(schedule[i].cameraWindow.width, expectedSize, `M${i} Width incorrect`);
        assert.strictEqual(schedule[i].cameraWindow.height, expectedSize, `M${i} Height incorrect`);
    }

    // Motion 0: Click (0,0) Input -> (0,0) Output
    // Box Center (0,0). TopLeft (-250, -250). Clamped to (0,0).
    assert.strictEqual(schedule[0].cameraWindow.x, 0, "M0 X incorrect");
    assert.strictEqual(schedule[0].cameraWindow.y, 0, "M0 Y incorrect");

    // Motion 1: Click (1000, 1000) Input -> (500, 500) Output
    // Box Center (500,500). TopLeft (250, 250).
    // Right Edge = 250 + 500 = 750 <= 1000. Valid.
    assert.strictEqual(schedule[1].cameraWindow.x, 250, "M1 X incorrect");
    assert.strictEqual(schedule[1].cameraWindow.y, 250, "M1 Y incorrect");

    // Motion 2: Click (2000, 2000) Input -> (1000, 1000) Output
    // Box Center (1000,1000). TopLeft (750, 750).
    // Box MaxX = 1000 - 500 = 500.
    // Clamped X = 500.
    assert.strictEqual(schedule[2].cameraWindow.x, 500, "M2 X incorrect");
    assert.strictEqual(schedule[2].cameraWindow.y, 500, "M2 Y incorrect");

    console.log(`✅ Scenario '${scenarioName}' Passed!`);
}

// Run Scenarios
runTest("Standard Zoom");

console.log("\n✅✅ All Scenarios Passed! ✅✅");
