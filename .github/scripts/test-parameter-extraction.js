#!/usr/bin/env node

// Simple test for parameter extraction
console.log('🧪 Testing Parameter Extraction Logic\n');

// Test case
const testBody = `### 🎼 Music Style Prompt

electronic, cyberpunk, dark ambient, 120 bpm

### 🎤 Lyrics or Structure

[verse]
Walking through neon lights
[chorus]
Digital dreams tonight

### ⏱️ Duration (seconds)

90

### 🎚️ Quality Mode

ultra`;

console.log('📋 Test Issue Body:');
console.log(testBody);
console.log('\n' + '─'.repeat(50));

// Test patterns
const promptPattern = /### 🎼 Music Style Prompt\s*\n\s*([^\n]+)/i;
const lyricsPattern = /### 🎤 Lyrics or Structure\s*\n\s*([\s\S]*?)(?=\n### |\n\n### |$)/i;
const durationPattern = /### ⏱️ Duration \(seconds\)\s*\n\s*(\d+)/i;
const modePattern = /### 🎚️ Quality Mode\s*\n\s*(fast|quality|ultra)/i;

// Extract parameters
const promptMatch = testBody.match(promptPattern);
const lyricsMatch = testBody.match(lyricsPattern);
const durationMatch = testBody.match(durationPattern);
const modeMatch = testBody.match(modePattern);

console.log('🎯 Extraction Results:');
console.log(`Prompt: ${promptMatch ? `"${promptMatch[1].trim()}"` : 'NOT FOUND'}`);
console.log(`Lyrics: ${lyricsMatch ? `"${lyricsMatch[1].trim()}"` : 'NOT FOUND'}`);
console.log(`Duration: ${durationMatch ? `"${durationMatch[1].trim()}"` : 'NOT FOUND'}`);
console.log(`Mode: ${modeMatch ? `"${modeMatch[1].trim()}"` : 'NOT FOUND'}`);

console.log('\n✅ Test complete!'); 