#!/usr/bin/env node

/**
 * Downloads Whisper model files from Hugging Face for local bundling.
 * This avoids CDN loading issues in Chrome extensions.
 */

import { createWriteStream, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Readable } from 'stream';
import { finished } from 'stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, '../public/models/Xenova');

// Download both whisper-base (multilingual) and whisper-base.en (English-only)
const MODELS = [
    {
        name: 'whisper-base.en',
        files: [
            'config.json',
            'generation_config.json',
            'preprocessor_config.json',
            'tokenizer_config.json',
            'tokenizer.json',
            'onnx/decoder_model_merged_quantized.onnx',
            'onnx/encoder_model_quantized.onnx'
        ]
    },
    {
        name: 'whisper-base',
        files: [
            'config.json',
            'generation_config.json',
            'preprocessor_config.json',
            'tokenizer_config.json',
            'tokenizer.json',
            'onnx/decoder_model_merged_quantized.onnx',
            'onnx/encoder_model_quantized.onnx'
        ]
    }
];

async function downloadFile(url, dest) {
    const dir = dirname(dest);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    if (existsSync(dest)) {
        console.log(`✓ Already exists: ${dest}`);
        return;
    }

    console.log(`Downloading: ${url}`);

    try {
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // For JSON files, we can write directly
        if (url.endsWith('.json')) {
            const data = await response.text();
            writeFileSync(dest, data);
            console.log(`✓ Downloaded: ${dest}`);
        } else {
            // For binary files (ONNX), stream to file
            const fileStream = createWriteStream(dest);
            await finished(Readable.fromWeb(response.body).pipe(fileStream));
            console.log(`✓ Downloaded: ${dest}`);
        }
    } catch (error) {
        throw new Error(`Failed to download ${url}: ${error.message}`);
    }
}

async function main() {
    console.log('📦 Downloading Whisper models...\n');

    for (const model of MODELS) {
        console.log(`\n📁 Model: ${model.name}`);
        const modelDir = join(MODELS_DIR, model.name);
        const baseUrl = `https://huggingface.co/Xenova/${model.name}/resolve/main`;

        for (const file of model.files) {
            const url = `${baseUrl}/${file}`;
            const dest = join(modelDir, file);

            try {
                await downloadFile(url, dest);
            } catch (error) {
                console.error(`✗ Failed to download ${file}:`, error.message);
                process.exit(1);
            }
        }
    }

    console.log('\n✅ All models downloaded successfully!');
    console.log(`📁 Models saved to: ${MODELS_DIR}`);
}

main().catch(console.error);
