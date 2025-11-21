import os
import re
import json
from pathlib import Path
from tqdm import tqdm
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('gap_fix.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# File paths - use absolute paths to avoid directory issues
ROOT_DIR = Path('D:/mentria-latest/website')
OUTPUT_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharat_translated.txt"
RAW_OUTPUT_DIR = ROOT_DIR / "build" / "assets" / "data" / "reference" / "raw"
FIXED_OUTPUT_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharat_translated_fixed.txt"

def extract_line_number(line):
    """Extract line number from a table row."""
    match = re.search(r'Line (\d+):', line)
    if match:
        return int(match.group(1))
    return 0

def analyze_gaps():
    """Analyze gaps in the translation output file."""
    print("\n=== Analyzing Gaps in Translation Output ===\n")
    
    # First get the line numbers from the current output file
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            content = f.readlines()
        
        translated_lines = []
        for line in content[2:]:  # Skip header
            line = line.strip()
            if line:
                line_num = extract_line_number(line)
                if line_num > 0:
                    translated_lines.append(line_num)
        
        translated_lines.sort()
        
        # Find gaps
        if not translated_lines:
            print("No translated lines found in the output file.")
            return
        
        min_line = translated_lines[0]
        max_line = translated_lines[-1]
        
        print(f"Line range in translation output: {min_line} to {max_line}")
        print(f"Total lines in translation output: {len(translated_lines)}")
        
        # Calculate what should be there
        expected_total = max_line - min_line + 1
        print(f"Expected lines if sequential: {expected_total}")
        print(f"Missing lines: {expected_total - len(translated_lines)}")
        
        # Find gaps larger than 10 lines
        gaps = []
        prev_line = min_line
        for line in translated_lines:
            if line > prev_line + 1:
                gap_size = line - prev_line - 1
                if gap_size > 10:
                    gaps.append((prev_line + 1, line - 1, gap_size))
            prev_line = line
        
        print("\nLarge gaps found:")
        for start, end, size in sorted(gaps, key=lambda x: x[2], reverse=True):
            print(f"Gap from line {start} to {end} ({size} lines)")
            
    except Exception as e:
        print(f"Error analyzing gaps: {e}")

def fix_translation_order():
    """Fix the order and gaps in the translation output file by analyzing all raw files."""
    logger.info("Starting thorough gap fixing process...")
    
    # Get all raw translation files
    raw_files = list(RAW_OUTPUT_DIR.glob("raw_translation_*.txt"))
    logger.info(f"Found {len(raw_files)} raw translation files to process")
    
    # Track line coverage
    line_coverage = set()
    translations_by_line = {}
    batch_line_ranges = []
    
    # First pass: Extract line ranges from all raw files
    logger.info("First pass: Extracting line ranges from raw files...")
    for raw_file in tqdm(raw_files, desc="Analyzing raw files"):
        try:
            # Extract line range from filename
            filename = raw_file.name
            match = re.search(r'raw_translation_(\d+)_(\d+)\.txt', filename)
            if not match:
                logger.warning(f"Skipping file with invalid name format: {filename}")
                continue
                
            start_line = int(match.group(1))
            end_line = int(match.group(2))
            batch_line_ranges.append((start_line, end_line, raw_file))
            
            # Mark these lines as potentially covered
            for line_num in range(start_line, end_line + 1):
                line_coverage.add(line_num)
                
        except Exception as e:
            logger.warning(f"Error processing file name {raw_file}: {e}")
    
    batch_line_ranges.sort(key=lambda x: x[0])  # Sort by start line
    
    # Verify ranges and look for gaps
    logger.info("Checking for gaps in raw file coverage...")
    
    if batch_line_ranges:
        min_line = batch_line_ranges[0][0]
        max_line = max(end for _, end, _ in batch_line_ranges)
        logger.info(f"Raw files cover lines {min_line} to {max_line}")
        
        # Find gaps in raw file coverage
        gaps = []
        for i in range(len(batch_line_ranges) - 1):
            current_end = batch_line_ranges[i][1]
            next_start = batch_line_ranges[i+1][0]
            if next_start > current_end + 1:
                gaps.append((current_end, next_start))
        
        if gaps:
            for start, end in gaps:
                logger.warning(f"Gap in raw file coverage: lines {start+1} to {end-1}")
    
    # Second pass: Extract translations from raw files
    logger.info("Second pass: Extracting translations from raw files...")
    for start_line, end_line, raw_file in tqdm(batch_line_ranges, desc="Processing raw files"):
        try:
            # Read raw file content and extract translations
            with open(raw_file, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Extract translations from the markdown table
            lines = content.strip().split('\n')
            table_rows = []
            
            # Skip header lines and find the table
            table_start = False
            for i, line in enumerate(lines):
                if line.startswith('|') and '**Sanskrit**' in line:
                    table_start = True
                    continue
                    
                # Skip separator line
                if table_start and line.startswith('|') and '---' in line:
                    continue
                    
                # Process table rows after header is found
                if table_start and line.startswith('|'):
                    parsed_line = line.strip()
                    line_num = extract_line_number(parsed_line)
                    
                    # Handle lines with explicit line numbers
                    if line_num > 0:
                        translations_by_line[line_num] = parsed_line
                        table_rows.append((line_num, parsed_line))
                    else:
                        # Handle blank or unnumbered lines - assign based on position
                        # Estimate line number based on batch start and position
                        estimated_line = start_line + len(table_rows)
                        if estimated_line <= end_line:
                            translations_by_line[estimated_line] = parsed_line
                            table_rows.append((estimated_line, parsed_line))
        except Exception as e:
            logger.warning(f"Error processing file {raw_file}: {e}")
    
    # Write to fixed output file
    logger.info(f"Writing {len(translations_by_line)} translations to fixed output file")
    with open(FIXED_OUTPUT_FILE, 'w', encoding='utf-8') as out_file:
        out_file.write("| **Sanskrit** | **English Translation** |\n")
        out_file.write("|-------------|-------------------------|\n")
        
        # Write in order of line numbers
        for line_num in sorted(translations_by_line.keys()):
            out_file.write(f"{translations_by_line[line_num]}\n")
    
    # Check for gaps in output
    all_lines = sorted(translations_by_line.keys())
    if all_lines:
        min_output = min(all_lines)
        max_output = max(all_lines)
        expected_count = max_output - min_output + 1
        
        logger.info(f"Fixed output contains lines {min_output} to {max_output}")
        logger.info(f"Total lines in fixed output: {len(all_lines)}")
        logger.info(f"Expected lines if sequential: {expected_count}")
        
        missing = expected_count - len(all_lines)
        if missing > 0:
            logger.warning(f"There are still {missing} missing lines in the fixed output")
            
            # Find large gaps
            gaps = []
            prev_line = min_output
            for line in all_lines:
                if line > prev_line + 1:
                    gap_size = line - prev_line - 1
                    if gap_size > 10:
                        gaps.append((prev_line + 1, line - 1, gap_size))
                prev_line = line
            
            if gaps:
                logger.warning("Large gaps remaining:")
                for start, end, size in sorted(gaps, key=lambda x: x[2], reverse=True):
                    logger.warning(f"  Gap from line {start} to {end} ({size} lines)")
    
    # Make backup of original and replace with fixed file
    backup_file = OUTPUT_FILE.with_suffix('.bak')
    try:
        import shutil
        shutil.copy2(OUTPUT_FILE, backup_file)
        logger.info(f"Created backup of original file at {backup_file}")
        
        # Replace original with fixed
        shutil.copy2(FIXED_OUTPUT_FILE, OUTPUT_FILE)
        logger.info(f"Replaced {OUTPUT_FILE} with fixed version")
    except Exception as e:
        logger.error(f"Error creating backup or replacing file: {e}")
        logger.info(f"Fixed file is available at {FIXED_OUTPUT_FILE}")
    
    logger.info("Translation gap fixing process complete")

if __name__ == "__main__":
    # First analyze gaps
    analyze_gaps()
    
    # Then fix them
    fix_translation_order()
    
    print("\nGap fixing complete. You can now run the optimized translator script.")
    print("Command: python optimized_translator.py") 