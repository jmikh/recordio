
import fs from 'fs';
import { PNG } from 'pngjs';
import path from 'path';

const args = process.argv.slice(2);

if (args.length === 0) {
    console.error('Please provide an image path.');
    process.exit(1);
}

const imagePath = args[0];
const absolutePath = path.resolve(process.cwd(), imagePath);

if (!fs.existsSync(absolutePath)) {
    console.error(`File not found: ${absolutePath}`);
    process.exit(1);
}

fs.createReadStream(absolutePath)
    .pipe(new PNG({ filterType: 4 }))
    .on('parsed', function () {
        const width = this.width;
        const height = this.height;

        console.log(`Analyzing ${path.basename(absolutePath)}...`);
        console.log(`Dimensions: ${width}x${height}`);

        const visited = new Uint8Array(width * height); // 0: unvisited, 1: visited/background, 2: visited/internal

        // Helper to get index
        const idx = (x: number, y: number) => (width * y + x) << 2;

        // Check if pixel is transparent
        const isTransparent = (x: number, y: number) => {
            const alpha = this.data[idx(x, y) + 3];
            return alpha === 0;
        };

        // 1. Flood fill from edges to mark outer transparency (background)
        const bgQueue: [number, number][] = [];

        // Add all edge pixels to queue if they are transparent
        for (let x = 0; x < width; x++) {
            if (isTransparent(x, 0)) bgQueue.push([x, 0]);
            if (isTransparent(x, height - 1)) bgQueue.push([x, height - 1]);
        }
        for (let y = 0; y < height; y++) {
            if (isTransparent(0, y)) bgQueue.push([0, y]);
            if (isTransparent(width - 1, y)) bgQueue.push([width - 1, y]);
        }

        while (bgQueue.length > 0) {
            const [x, y] = bgQueue.pop()!;
            const flatIdx = y * width + x;

            if (visited[flatIdx]) continue;
            visited[flatIdx] = 1; // Mark as background

            const neighbors = [
                [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]
            ];

            for (const [nx, ny] of neighbors) {
                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    if (isTransparent(nx, ny) && visited[ny * width + nx] === 0) {
                        bgQueue.push([nx, ny]);
                    }
                }
            }
        }

        // 2. Find Connected Components of remaining transparent pixels
        interface Rect {
            x: number;
            y: number;
            w: number;
            h: number;
            area: number;
        }

        const components: Rect[] = [];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const flatIdx = y * width + x;
                // If transparent and not visited (so it's an internal hole)
                if (isTransparent(x, y) && visited[flatIdx] === 0) {
                    // Start a new component flood fill
                    let minX = x, maxX = x;
                    let minY = y, maxY = y;
                    let count = 0;

                    const compQueue: [number, number][] = [[x, y]];

                    while (compQueue.length > 0) {
                        const [cx, cy] = compQueue.pop()!;
                        const cFlatIdx = cy * width + cx;

                        if (visited[cFlatIdx] !== 0) continue;
                        visited[cFlatIdx] = 2; // Mark as internal component
                        count++;

                        if (cx < minX) minX = cx;
                        if (cx > maxX) maxX = cx;
                        if (cy < minY) minY = cy;
                        if (cy > maxY) maxY = cy;

                        const neighbors = [
                            [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]
                        ];

                        for (const [nx, ny] of neighbors) {
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                if (isTransparent(nx, ny) && visited[ny * width + nx] === 0) {
                                    compQueue.push([nx, ny]);
                                }
                            }
                        }
                    }

                    components.push({
                        x: minX,
                        y: minY,
                        w: maxX - minX + 1,
                        h: maxY - minY + 1,
                        area: count
                    });
                }
            }
        }

        // 3. Filter Components
        // Criteria: Component width OR height must be > 10% of image dimensions
        const minW = width * 0.1;
        const minH = height * 0.1;

        const validComponents = components.filter(c => c.w > minW || c.h > minH);

        if (validComponents.length > 0) {
            // 4. Select the "main" screen (largest area)
            // Sorting by pixel count (area) to be safest
            validComponents.sort((a, b) => b.area - a.area);
            const screen = validComponents[0];

            console.log('\n--- Result ---');
            console.log(`const FRAME_W = ${width};`);
            console.log(`const FRAME_H = ${height};`);
            console.log('');
            console.log(`const SCREEN_X = ${screen.x};`);
            console.log(`const SCREEN_Y = ${screen.y};`);
            console.log(`const SCREEN_W = ${screen.w};`);
            console.log(`const SCREEN_H = ${screen.h};`);

            if (validComponents.length > 1) {
                console.log(`\n(Note: Found ${validComponents.length} valid transparent regions. Selected the largest one.)`);
            }
        } else {
            console.log('No inner transparent screen found (checked filters > 10% dimension).');
        }
    })
    .on('error', (err) => {
        console.error('Error parsing PNG:', err);
    });
