import os
import json
import re
from pathlib import Path
from tqdm import tqdm

# File paths - use absolute paths to avoid directory issues
ROOT_DIR = Path('D:/mentria-latest/website')
OUTPUT_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharat_translated.txt"
RAW_OUTPUT_DIR = ROOT_DIR / "build" / "assets" / "data" / "reference" / "raw"
PROGRESS_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "translation_progress.json"
FIXED_OUTPUT_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharat_translated_fixed.txt"

def extract_line_number(line):
    """Extract line number from a table row."""
    match = re.search(r'Line (\d+):', line)
    if match:
        return int(match.group(1))
    return 0

def fix_translations():
    """Fix the order of translations in the output file."""
    print(f"Loading raw translation files from: {RAW_OUTPUT_DIR}")
    
    # Get all raw translation files
    raw_files = list(RAW_OUTPUT_DIR.glob("raw_translation_*.txt"))
    print(f"Found {len(raw_files)} raw translation files")
    
    # Extract line numbers and content from raw files
    translations = []
    
    for raw_file in tqdm(raw_files, desc="Processing raw files"):
        try:
            # Extract line range from filename
            filename = raw_file.name
            match = re.search(r'raw_translation_(\d+)_(\d+)\.txt', filename)
            if not match:
                print(f"Skipping file with invalid name format: {filename}")
                continue
                
            start_line = int(match.group(1))
            end_line = int(match.group(2))
            
            # Read and parse the file
            with open(raw_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Extract translations from the markdown table
            lines = content.strip().split('\n')
            table_rows = []
            
            # Skip header lines and find the table
            table_start = False
            for line in lines:
                if line.startswith('|') and '**Sanskrit**' in line:
                    table_start = True
                    continue
                    
                # Skip separator line
                if table_start and line.startswith('|') and '---' in line:
                    continue
                    
                # Process table rows after header is found
                if table_start and line.startswith('|'):
                    line_num = extract_line_number(line)
                    if line_num > 0:
                        translations.append((line_num, line))
                    else:
                        # For blank lines
                        translations.append((start_line + len(table_rows), line))
                    table_rows.append(line)
                    
        except Exception as e:
            print(f"Error processing file {raw_file}: {e}")
    
    # Sort translations by line number
    translations.sort(key=lambda x: x[0])
    
    # Write to fixed output file
    print(f"Writing {len(translations)} translations to: {FIXED_OUTPUT_FILE}")
    with open(FIXED_OUTPUT_FILE, 'w', encoding='utf-8') as out_file:
        out_file.write("| **Sanskrit** | **English Translation** |\n")
        out_file.write("|-------------|-------------------------|\n")
        
        for _, line in translations:
            out_file.write(f"{line}\n")
    
    print("Fixed translation file created successfully.")
    print(f"Original file: {OUTPUT_FILE}")
    print(f"Fixed file: {FIXED_OUTPUT_FILE}")
    print("Please verify the fixed file and rename it if it looks correct.")

if __name__ == "__main__":
    fix_translations() 