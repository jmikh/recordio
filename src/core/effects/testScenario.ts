import { calculateZoomSchedule, ViewTransform } from './viewportMotion.ts';
import { generateMouseEffects } from './mouseEffects.ts';
import type { UserEvent, Clip } from '../types.ts';

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

    // Default: One clip covering the whole source range
    // Assuming source is 0 to inputVideoHeight (infinity)
    const defaultClip: Clip = {
        id: 'default', sourceId: 'src', sourceInMs: 0, sourceOutMs: 100000, timelineInMs: 0, speed: 1, audioVolume: 1, audioMuted: false
    };

    // For specific scenarios, we might override clips
    let clips = [defaultClip];

    if (scenarioName === "Clip Filtering") {
        // Clip 1: 0-2000 -> Timeline 0-2000
        const c1: Clip = { ...defaultClip, id: 'c1', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0 };
        // Clip 2: 4000-6000 -> Timeline 2000-4000 (Skips 2000-4000 source)
        const c2: Clip = { ...defaultClip, id: 'c2', sourceInMs: 4000, sourceOutMs: 6000, timelineInMs: 2000 };
        clips = [c1, c2];
    } else if (scenarioName === "Cut Drag") {
        // Clip 1: 0-2000 -> Timeline 0-2000
        const c1: Clip = { ...defaultClip, id: 'c1', sourceInMs: 0, sourceOutMs: 2000, timelineInMs: 0 };
        clips = [c1];
    }

    console.log("Running Zoom Schedule Calculation...");
    const schedule = calculateZoomSchedule(zoom, mappingConfig, events, clips);

    console.log("--- Generated Schedule ---");
    schedule.forEach((k, i) => {
        console.log(`Motion #${i}: timeOut=${k.timeOutMs}`);
        console.log(`  Target: x=${k.viewport.x}, y=${k.viewport.y}, w=${k.viewport.width}, h=${k.viewport.height}`);
    });

    console.log("--- Running Assertions ---");

    // Assertions based on Scenario
    if (scenarioName === "Standard Zoom") {
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
            assert.strictEqual(schedule[i].viewport.width, expectedSize, `M${i} Width incorrect`);
            assert.strictEqual(schedule[i].viewport.height, expectedSize, `M${i} Height incorrect`);
        }

        // Motion 0: Click (0,0) Input -> (0,0) Output
        assert.strictEqual(schedule[0].viewport.x, 0, "M0 X incorrect");
        assert.strictEqual(schedule[0].viewport.y, 0, "M0 Y incorrect");

        // Motion 1: Click (1000, 1000) Input -> (500, 500) Output
        assert.strictEqual(schedule[1].viewport.x, 250, "M1 X incorrect");
        assert.strictEqual(schedule[1].viewport.y, 250, "M1 Y incorrect");

        // Motion 2: Click (2000, 2000) Input -> (1000, 1000) Output
        assert.strictEqual(schedule[2].viewport.x, 500, "M2 X incorrect");
        assert.strictEqual(schedule[2].viewport.y, 500, "M2 Y incorrect");

    } else if (scenarioName === "Clip Filtering") {
        // Event 1 (1000) -> Mapped 1000
        // Event 2 (3000) -> Skipped
        // Event 3 (5000) -> Mapped 3000 (2000 + (5000-4000))
        // Expect 2 Zoom Ins + 1 Zoom Out = 3 Motions
        assert.strictEqual(schedule.length, 3, "Should have 3 motions");

        // Check Times
        assert.strictEqual(schedule[0].timeOutMs, 1000, "M0 time incorrect");
        assert.strictEqual(schedule[1].timeOutMs, 3000, "M1 time incorrect");

        // Check Zoom Out exists
        assert.strictEqual(schedule[2].viewport.width, outputVideoWidth, "M2 (Final) should be full view");

    } else if (scenarioName === "Cut Drag") {
        console.log("Testing Mouse Effects for Cut Drag...");
        const effects = generateMouseEffects(events, clips);

        // Expecting 1 drag effect
        assert.strictEqual(effects.length, 1, "Should have 1 drag effect");

        const drag = effects[0];
        assert.strictEqual(drag.type, 'drag', "Effect should be drag");

        // Drag starts at 1000 (Source) -> 1000 (Map)
        // Clip 1 is 0-2000.
        // Drag continues until Clip 1 ends at 2000.
        // Synthetic Mouse Up should be injected at 2000.
        assert.strictEqual(drag.timeInMs, 1000, "Drag Start Time Incorrect");
        assert.strictEqual(drag.timeOutMs, 2000, "Drag End Time Incorrect (Should be clamped to clip end)");

        // Check Path
        // Start: 1000
        // End: 2000
        assert.strictEqual(drag.end?.x, 0, "Drag End X should match last known or start");
    }

    console.log(`✅ Scenario '${scenarioName}' Passed!`);
}

// Run Scenarios
runTest("Standard Zoom");
runTest("Clip Filtering");

// Setup for Cut Drag
// Drag starts at 1000. Clip ends at 2000. No explicit mouse up in event stream <= 2000.
// (Actually we can reuse events array but it has clicks. Let's make a custom event set inside runTest or just swap global variable?)
// "runTest" uses global "events". Let's hack it for the test.
events.length = 0;
events.push({ type: 'mousedown', timestamp: 1000, x: 0, y: 0 });
// No mouseup
runTest("Cut Drag");
// Restore? Not needed strictly as script ends.
console.log("\n✅✅ All Scenarios Passed! ✅✅");
