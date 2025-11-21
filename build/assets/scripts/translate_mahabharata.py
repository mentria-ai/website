import os
import time
import anthropic
from dotenv import load_dotenv
from pathlib import Path
import re
import json

# Load environment variables from .env file
load_dotenv()

# Initialize Anthropic client with caching enabled
# Note: cache_control parameter is for future compatibility, may not be supported in current version
try:
    client = anthropic.Anthropic(cache_control={"type": "ephemeral"})
    print("Using Anthropic client with caching enabled")
except TypeError:
    # Fall back to standard client if cache_control is not supported
    client = anthropic.Anthropic()
    print("Using standard Anthropic client (caching not supported)")

# File paths - use absolute paths to avoid directory issues
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = Path('D:/mentria-latest/website')
SOURCE_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharata.txt"
OUTPUT_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharat_translated.txt"
RAW_OUTPUT_DIR = ROOT_DIR / "build" / "assets" / "data" / "reference" / "raw"

# Create output directories if they don't exist
OUTPUT_FILE.parent.mkdir(exist_ok=True, parents=True)
RAW_OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

# Print paths for debugging
print(f"Script directory: {SCRIPT_DIR}")
print(f"Root directory: {ROOT_DIR}")
print(f"Source file: {SOURCE_FILE}")
print(f"Output file: {OUTPUT_FILE}")
print(f"Raw output directory: {RAW_OUTPUT_DIR}")
print(f"Source file exists: {SOURCE_FILE.exists()}")

# Translation batch settings
BATCH_SIZE = 10
CONTEXT_BEFORE = 50
CONTEXT_AFTER = 50
DELAY_BETWEEN_REQUESTS = 1  # seconds, reduced to 1 second as suggested

def read_lines(file_path, start_line, end_line):
    """Read specific lines from a file."""
    lines = []
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            for i, line in enumerate(file, 1):
                if i >= start_line and i <= end_line:
                    lines.append(line.strip())
                if i > end_line:
                    break
    except Exception as e:
        print(f"Error reading file: {e}")
        raise
    return lines

def count_lines(file_path):
    """Count the number of lines in a file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return sum(1 for _ in file)
    except Exception as e:
        print(f"Error counting lines in file: {e}")
        raise

def create_prompt(lines_to_translate, context_before=None, context_after=None, start_line_num=1):
    """Create the translation prompt."""
    prompt = "Translate the following Sanskrit text (in Devanagari script) to English. Maintain the exact same line numbers.\n\n"
    
    # Add context information
    if context_before:
        prompt += "PREVIOUS TRANSLATION CONTEXT (reference only):\n"
        for line in context_before:
            prompt += line + "\n"
        prompt += "\n---\n\n"
    
    # Add the lines to translate
    prompt += "LINES TO TRANSLATE (these line numbers: {} to {}):\n".format(
        start_line_num, start_line_num + len(lines_to_translate) - 1
    )
    for i, line in enumerate(lines_to_translate):
        prompt += f"Line {start_line_num + i}: {line}\n"
    
    # Add forward context
    if context_after:
        prompt += "\n---\n\nFORWARD CONTEXT (reference only):\n"
        for line in context_after:
            prompt += line + "\n"
    
    # Add format instructions
    prompt += "\n\nPlease translate each line with its meaning and cultural context. Format your response as a markdown table with Sanskrit and English columns as follows:\n"
    prompt += """
| **Sanskrit** | **English Translation** |
|-------------|-------------------------|
| `Line X: [Sanskrit text]` | "[English translation with short contextual explanations in square brackets]" |

For each line, copy the original Sanskrit text exactly as it appears in the source. Then provide an English translation that preserves the original meaning. For important terms (names, deities, special concepts), include a brief explanation (2-3 words max) in square brackets immediately after the term, like: "Nārāyaṇa [Supreme Lord]" or "Sarasvatī [learning deity]".

If a line is blank, indicate [Blank line] in the translation column. Make sure each translation is accurate and culturally appropriate.
"""
    return prompt

def translate_batch(lines_to_translate, context_before=None, context_after=None, start_line_num=1):
    """Translate a batch of lines using Anthropic API."""
    prompt = create_prompt(lines_to_translate, context_before, context_after, start_line_num)
    
    try:
        # Try with cache_control parameter if supported
        try:
            response = client.messages.create(
                model="claude-3-7-sonnet-20250219",
                max_tokens=4000,
                temperature=0.2,  # Lower temperature for more accurate translations
                system="You are a world-class Sanskrit scholar specializing in the Mahabharata. Your task is to translate Sanskrit verses into English accurately, preserving the meaning, context, and cultural significance. For each line, provide a clear translation with short contextual explanations (2-3 words max) in square brackets after important terms. For example: 'Nārāyaṇa [Supreme Lord]' or 'Jaya [Victory epic]'. Maintain the exact format requested, and be sure to copy the original Sanskrit text exactly as it appears.",
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                cache_control={"type": "ephemeral"} # Enable prompt caching if supported
            )
        except TypeError:
            # Fall back if cache_control is not supported
            response = client.messages.create(
                model="claude-3-7-sonnet-20250219",
                max_tokens=4000,
                temperature=0.2,
                system="You are a world-class Sanskrit scholar specializing in the Mahabharata. Your task is to translate Sanskrit verses into English accurately, preserving the meaning, context, and cultural significance. For each line, provide a clear translation with short contextual explanations (2-3 words max) in square brackets after important terms. For example: 'Nārāyaṇa [Supreme Lord]' or 'Jaya [Victory epic]'. Maintain the exact format requested, and be sure to copy the original Sanskrit text exactly as it appears.",
                messages=[
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            )
        return response.content[0].text
    except Exception as e:
        print(f"Error calling Anthropic API: {str(e)}")
        time.sleep(30)  # Wait longer if there's an error
        return ""

def extract_translations(translation_text):
    """Extract translations from the markdown table."""
    translations = []
    lines = translation_text.strip().split('\n')
    
    # Skip header lines and find the table
    table_start = False
    for i, line in enumerate(lines):
        if line.startswith('|') and '**Sanskrit**' in line:
            table_start = True
            # Add header to translations
            translations.append(line)
            # Add separator line if it exists
            if i+1 < len(lines) and lines[i+1].startswith('|') and '---' in lines[i+1]:
                translations.append(lines[i+1])
            continue
            
        # Process table rows after header is found
        if table_start and line.startswith('|'):
            translations.append(line)
    
    return translations

def process_mahabharata():
    """Process the entire Mahabharata text in batches."""
    # Get total lines
    total_lines = count_lines(SOURCE_FILE)
    print(f"Total lines to process: {total_lines}")
    
    # Initialize the output file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_file:
        out_file.write("| **Sanskrit** | **English Translation** |\n")
        out_file.write("|-------------|-------------------------|\n")
    
    # Process in batches
    # Note: Batch API processing would be ideal but is not supported in current SDK
    for start_line in range(1, total_lines + 1, BATCH_SIZE):
        end_line = min(start_line + BATCH_SIZE - 1, total_lines)
        
        print(f"Processing lines {start_line} to {end_line}...")
        
        # Get lines to translate
        lines_to_translate = read_lines(SOURCE_FILE, start_line, end_line)
        
        # Get context before (from translated file)
        context_before = []
        if start_line > 1:
            context_start = max(1, start_line - CONTEXT_BEFORE)
            with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                all_lines = f.readlines()
                # Skip the header (first 2 lines)
                context_before = [line.strip() for line in all_lines[2:] if line.strip()][-CONTEXT_BEFORE:]
        
        # Get context after (from source file)
        context_after = []
        if end_line < total_lines:
            context_after = read_lines(SOURCE_FILE, end_line + 1, min(end_line + CONTEXT_AFTER, total_lines))
        
        # Translate current batch
        translation = translate_batch(lines_to_translate, context_before, context_after, start_line)
        
        # Save raw translation for debugging
        raw_file = RAW_OUTPUT_DIR / f"raw_translation_{start_line}_{end_line}.txt"
        with open(raw_file, 'w', encoding='utf-8') as f:
            f.write(translation)
        
        # Extract and save translations
        translations = extract_translations(translation)
        
        if not translations:
            print(f"Warning: No translations extracted for lines {start_line} to {end_line}")
            print("Raw translation response saved for debugging")
            continue
            
        with open(OUTPUT_FILE, 'a', encoding='utf-8') as out_file:
            # Skip the header lines if they exist
            data_rows = []
            for line in translations:
                if '**Sanskrit**' in line or '----------' in line:
                    continue
                data_rows.append(line)
                    
            for row in data_rows:
                out_file.write(f"{row}\n")
        
        print(f"Completed lines {start_line} to {end_line}")
        time.sleep(DELAY_BETWEEN_REQUESTS)  # Reduced delay between requests

if __name__ == "__main__":
    if not os.getenv("ANTHROPIC_API_KEY"):
        print("Error: ANTHROPIC_API_KEY not found in environment variables or .env file")
        exit(1)
        
    print("Starting Mahabharata translation...")
    process_mahabharata()
    print("Translation complete. Output saved to:", OUTPUT_FILE) 