# Icon System - Recordio

## Overview
All Recordio icons are now generated from a single source image (`src/assets/logo-source.png`) and automatically colored with the primary brand color defined in the icon generator script.

## Generated Icons

The script generates the following icon sizes:
- **16x16** → `public/icons/icon16.png` (browser tab/favicon)
- **48x48** → `public/icons/icon48.png` (extension toolbar)
- **128x128** → `public/icons/icon128.png` (extension store)
- **256x256** → `src/assets/logo.png` (app logo)

## Usage

### Regenerate Icons with Updated Color

1. Open `scripts/generateIcons.js`
2. Update the `OKLCH_COLOR` configuration at the top:
   ```javascript
   const OKLCH_COLOR = {
     l: 0.58,   // Lightness (0-1)
     c: 0.19,   // Chroma (0-0.4)
     h: 290     // Hue (0-360)
   };
   ```
3. Run the generator:
   ```bash
   npm run generate-icons
   ```
4. Build the project:
   ```bash
   npm run build:dev
   ```

### Current Color
- **OKLCH**: `oklch(0.58, 0.19, 290)` 
- **RGB**: `rgb(125, 94, 224)`
- Matches `--primary` from `src/index.css`

## How It Works

The script:
1. Reads the source logo from `src/assets/logo-source.png`
2. Converts the OKLCH color to RGB
3. For each size:
   - Resizes the source image
   - Applies the primary color to all non-transparent pixels using multiply blend mode
   - Saves the PNG

## Updating the Source Logo

To use a different logo base image:
1. Replace `src/assets/logo-source.png` with your new image
2. Run `npm run generate-icons`

The color will automatically be applied to all non-transparent pixels.
