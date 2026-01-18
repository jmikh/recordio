#!/usr/bin/env node
/**
 * Icon Generator Script
 * 
 * Generates icons in two styles:
 * 1. Extension icons (16, 48, 128): Black background + purple logo + rounded corners
 * 2. App logo (256): Transparent background + purple logo
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// CONFIGURATION
// ============================================================
const OKLCH_COLOR = {
    l: 0.58,   // Lightness (0-1)
    c: 0.19,   // Chroma (0-0.4)
    h: 290     // Hue (0-360)
};

const EXTENSION_ICON_CONFIG = {
    logoScale: 0.85,        // Logo takes 85% of icon size
    cornerRadius: 0.15,     // Rounded corner radius (15% of size)
    usePurpleBackground: true  // Use purple background with white logo
};

// ============================================================
// Color Conversion
// ============================================================

function oklchToRgb({ l, c, h }) {
    const hRad = (h * Math.PI) / 180;
    const a = c * Math.cos(hRad);
    const b = c * Math.sin(hRad);

    const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

    const l3 = l_ * l_ * l_;
    const m3 = m_ * m_ * m_;
    const s3 = s_ * s_ * s_;

    let r = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
    let g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
    let b_ = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

    const gammaCorrect = (val) => {
        if (val <= 0.0031308) return 12.92 * val;
        return 1.055 * Math.pow(val, 1 / 2.4) - 0.055;
    };

    r = gammaCorrect(r);
    g = gammaCorrect(g);
    b_ = gammaCorrect(b_);

    return {
        r: Math.max(0, Math.min(255, Math.round(r * 255))),
        g: Math.max(0, Math.min(255, Math.round(g * 255))),
        b: Math.max(0, Math.min(255, Math.round(b_ * 255)))
    };
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create a rounded rectangle SVG mask
 */
function createRoundedRectMask(size, radius) {
    return Buffer.from(
        `<svg width="${size}" height="${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>`
    );
}

// ============================================================
// Main
// ============================================================

async function main() {
    console.log('🎨 Recordio Icon Generator\n');

    const projectRoot = path.join(__dirname, '..');
    const sourceLogoPath = path.join(projectRoot, 'src/assets/logo-source.png');
    const iconsDir = path.join(projectRoot, 'public/icons');
    const assetsDir = path.join(projectRoot, 'src/assets');

    if (!fs.existsSync(sourceLogoPath)) {
        console.error(`❌ Source logo not found: ${sourceLogoPath}`);
        console.log('   Expected: White logo on transparent background');
        process.exit(1);
    }

    const { r, g, b } = oklchToRgb(OKLCH_COLOR);
    console.log(`📌 Using OKLCH(${OKLCH_COLOR.l}, ${OKLCH_COLOR.c}, ${OKLCH_COLOR.h})`);
    console.log(`   RGB(${r}, ${g}, ${b})\n`);

    console.log('🖼️  Generating icons...\n');

    // Extension icons: Purple background + white logo + rounded corners
    const extensionSizes = [
        { size: 16, output: path.join(iconsDir, 'icon16.png') },
        { size: 48, output: path.join(iconsDir, 'icon48.png') },
        { size: 128, output: path.join(iconsDir, 'icon128.png') }
    ];

    for (const { size, output } of extensionSizes) {
        const logoSize = Math.round(size * EXTENSION_ICON_CONFIG.logoScale);
        const cornerRadius = Math.round(size * EXTENSION_ICON_CONFIG.cornerRadius);

        // Step 1: Create purple background
        const purpleBackground = await sharp({
            create: {
                width: size,
                height: size,
                channels: 4,
                background: { r, g, b, alpha: 1 }
            }
        }).png().toBuffer();

        // Step 2: Resize white logo
        const resizedWhiteLogo = await sharp(sourceLogoPath)
            .resize(logoSize, logoSize, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toBuffer();

        // Step 3: Composite white logo on purple background (centered)
        const offset = Math.round((size - logoSize) / 2);
        const iconWithLogo = await sharp(purpleBackground)
            .composite([{
                input: resizedWhiteLogo,
                top: offset,
                left: offset
            }])
            .toBuffer();

        // Step 4: Apply rounded corners
        const roundedMask = createRoundedRectMask(size, cornerRadius);

        await sharp(iconWithLogo)
            .composite([{
                input: roundedMask,
                blend: 'dest-in'
            }])
            .png()
            .toFile(output);

        console.log(`✓ ${size}x${size} → ${path.basename(output)} (purple bg + white logo, rounded)`);
    }

    // App logo: Transparent background + purple logo (unchanged)
    const logoSize = 256;
    const logoOutput = path.join(assetsDir, 'logo.png');

    const purpleRect = await sharp({
        create: {
            width: logoSize,
            height: logoSize,
            channels: 4,
            background: { r, g, b, alpha: 1 }
        }
    }).png().toBuffer();

    const resizedSource = await sharp(sourceLogoPath)
        .resize(logoSize, logoSize, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .toBuffer();

    await sharp(purpleRect)
        .composite([{
            input: resizedSource,
            blend: 'dest-in'
        }])
        .png()
        .toFile(logoOutput);

    console.log(`✓ ${logoSize}x${logoSize} → logo.png (transparent bg + purple logo)`);

    console.log('\n✅ Done!\n');
    console.log('Extension icons: Purple bg + white logo (85% scale, rounded corners)');
    console.log('App logo: Transparent bg + purple logo\n');
}

main().catch(err => {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
});
