import os
import re
from pathlib import Path
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# File paths - use absolute paths to avoid directory issues
ROOT_DIR = Path('D:/mentria-latest/website')
OUTPUT_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharat_translated.txt"

# Known gaps that we're targeting
TARGET_GAPS = [
    (5601, 5625),  # Gap 1: 25 lines
    (5776, 5800),  # Gap 2: 25 lines
    (5926, 5975)   # Gap 3: 50 lines
]

def extract_line_number(line):
    """Extract line number from a table row."""
    match = re.search(r'Line (\d+):', line)
    if match:
        return int(match.group(1))
    return 0

def monitor_translation_progress():
    """Check the progress of translation, focusing on the targeted gaps."""
    
    # Check if output file exists
    if not OUTPUT_FILE.exists():
        logger.error(f"Translation output file not found: {OUTPUT_FILE}")
        return
    
    # Read the output file and extract line numbers
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            content = f.readlines()
        
        translated_lines = set()
        for line in content:
            line_num = extract_line_number(line)
            if line_num > 0:
                translated_lines.add(line_num)
        
        # Get overall statistics
        total_translated = len(translated_lines)
        if translated_lines:
            min_line = min(translated_lines)
            max_line = max(translated_lines)
            expected_count = max_line - min_line + 1
            coverage_percent = (total_translated / expected_count) * 100
        else:
            min_line = 0
            max_line = 0
            expected_count = 0
            coverage_percent = 0
        
        print("\n=== Translation Progress ===\n")
        print(f"Total translated lines: {total_translated}")
        print(f"Line range: {min_line} to {max_line}")
        print(f"Coverage: {coverage_percent:.2f}% ({total_translated}/{expected_count})")
        
        # Check target gap progress
        print("\n=== Target Gap Progress ===\n")
        
        for start_gap, end_gap in TARGET_GAPS:
            gap_lines = set(range(start_gap, end_gap + 1))
            translated_in_gap = gap_lines.intersection(translated_lines)
            missing_in_gap = gap_lines - translated_lines
            
            gap_coverage = (len(translated_in_gap) / len(gap_lines)) * 100
            
            print(f"Gap {start_gap}-{end_gap}: {gap_coverage:.2f}% complete ({len(translated_in_gap)}/{len(gap_lines)} lines)")
            
            if missing_in_gap:
                if len(missing_in_gap) <= 5:
                    print(f"  Missing lines: {', '.join(str(line) for line in sorted(missing_in_gap))}")
                else:
                    # Show first 5 missing lines
                    sorted_missing = sorted(missing_in_gap)
                    print(f"  First 5 missing lines: {', '.join(str(line) for line in sorted_missing[:5])}")
                    print(f"  Last 5 missing lines: {', '.join(str(line) for line in sorted_missing[-5:])}")
            else:
                print("  ✓ All lines in this gap are translated!")
        
        # Find any other large gaps (more than 10 consecutive missing lines)
        all_lines = set(range(min_line, max_line + 1))
        missing_lines = all_lines - translated_lines
        
        if missing_lines:
            # Convert to list of consecutive ranges
            missing_ranges = []
            start = None
            
            for i in sorted(missing_lines):
                if start is None:
                    start = i
                    prev = i
                elif i == prev + 1:
                    prev = i
                else:
                    missing_ranges.append((start, prev))
                    start = i
                    prev = i
            
            if start is not None:
                missing_ranges.append((start, prev))
            
            # Filter for ranges larger than 10 lines
            large_gaps = [(start, end) for start, end in missing_ranges if end - start >= 10]
            
            if large_gaps:
                print("\n=== Other Large Gaps ===\n")
                for start, end in sorted(large_gaps, key=lambda x: x[1] - x[0], reverse=True)[:5]:
                    size = end - start + 1
                    print(f"Gap from line {start} to {end} ({size} lines)")
    
    except Exception as e:
        logger.error(f"Error monitoring translation progress: {e}")

if __name__ == "__main__":
    monitor_translation_progress() 