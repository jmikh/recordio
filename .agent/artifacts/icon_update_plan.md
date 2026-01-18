# Icon Update Implementation Plan

## Objective
Replace all icons with the new circular "Recordio" logo and create a script to apply the primary color from index.css to all icon sizes.

## Steps

### 1. Convert the uploaded PNG to SVG
- Create an SVG version of the icon that uses CSS variables for colors
- This allows dynamic color application via the script

### 2. Generate Icon Sizes
Create the following icon sizes:
- **16x16** - For browser tab/favicon
- **48x48** - For extension toolbar
- **128x128** - For extension store listing
- **256x256** - For high-res displays
- **512x512** - For promotional use

### 3. Create Color Application Script
Build a Node.js script that:
- Reads the `--primary` color value from `src/index.css`
- Parses OKLCH color values
- Converts to hex/rgb for PNG generation
- Applies the color to all icon variants
- Regenerates PNG icons from the SVG template

### 4. Update Manifest and Assets
- Replace `public/icons/*` with new icons
- Replace `src/assets/logo.png` with new logo
- Update `manifest.json` if needed

## Technical Details

### Script Location
`scripts/generateIcons.js`

### Script Capabilities
- Parse OKLCH color from CSS
- Convert OKLCH → RGB → Hex
- Apply color to SVG template
- Generate PNG files at multiple sizes using sharp or canvas

### Integration
Add to `package.json`:
```json
"scripts": {
  "generate-icons": "node scripts/generateIcons.js"
}
```

## Files to Create/Modify
1. `scripts/generateIcons.js` - Main script
2. `public/icons/icon-template.svg` - SVG template with color placeholders
3. Update all PNG icons in `public/icons/`
4. Update `src/assets/logo.png`
