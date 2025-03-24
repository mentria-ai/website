import os
import time
import json
import threading
import concurrent.futures
import anthropic
from dotenv import load_dotenv
from pathlib import Path
import re
import logging
from tqdm import tqdm

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('translation.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Load environment variables from .env file
load_dotenv()

# File paths - use absolute paths to avoid directory issues
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = Path('D:/mentria-latest/website')
SOURCE_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharata.txt"
OUTPUT_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "mahabharat_translated.txt"
RAW_OUTPUT_DIR = ROOT_DIR / "build" / "assets" / "data" / "reference" / "raw"
PROGRESS_FILE = ROOT_DIR / "build" / "assets" / "data" / "reference" / "translation_progress.json"

# Create output directories if they don't exist
OUTPUT_FILE.parent.mkdir(exist_ok=True, parents=True)
RAW_OUTPUT_DIR.mkdir(exist_ok=True, parents=True)

# Optimization settings
BATCH_SIZE = 25            # Standard batch size
MAX_WORKERS = 1            # Using 1 worker to prevent rate limiting
CONTEXT_BEFORE = 20        # Context for translation
CONTEXT_AFTER = 20         # Context for translation
RATE_LIMIT_DELAY = 7.0     # Delay between API calls
PROGRESS_SAVE_INTERVAL = 1 # Save progress after each batch
OUTPUT_UPDATE_INTERVAL = 1 # Update output file after each batch
AUTO_FIX_TRANSLATIONS = False # Disable automatic fix translations

# Remove gap targeting
PRIORITIZE_GAPS = False    # Disable prioritization of gaps

# Initialize the Anthropic client with the updated SDK
try:
    client = anthropic.Anthropic(
        api_key=os.environ.get("ANTHROPIC_API_KEY")
    )
    logger.info("Successfully initialized Anthropic client")
except Exception as e:
    logger.error(f"Error initializing client: {e}")
    exit(1)

# Lock for thread-safe file writing
file_lock = threading.Lock()

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
        logger.error(f"Error reading file: {e}")
        raise
    return lines

def count_lines(file_path):
    """Count the number of lines in a file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return sum(1 for _ in file)
    except Exception as e:
        logger.error(f"Error counting lines in file: {e}")
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

def translate_batch(batch_id, lines_to_translate, context_before=None, context_after=None, start_line_num=1):
    """Translate a batch of lines using Anthropic API."""
    prompt = create_prompt(lines_to_translate, context_before, context_after, start_line_num)
    
    try:
        # Try with cache_control parameter
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
            ],
        )
        result = response.content[0].text
        
        # Save raw translation for debugging
        raw_file = RAW_OUTPUT_DIR / f"raw_translation_{start_line_num}_{start_line_num + len(lines_to_translate) - 1}.txt"
        with open(raw_file, 'w', encoding='utf-8') as f:
            f.write(result)
            
        return {
            "batch_id": batch_id,
            "start_line": start_line_num,
            "end_line": start_line_num + len(lines_to_translate) - 1,
            "content": result,
            "success": True
        }
    except Exception as e:
        logger.error(f"Error in batch {batch_id} (lines {start_line_num}-{start_line_num + len(lines_to_translate) - 1}): {str(e)}")
        return {
            "batch_id": batch_id,
            "start_line": start_line_num,
            "end_line": start_line_num + len(lines_to_translate) - 1,
            "content": None,
            "success": False,
            "error": str(e)
        }

def extract_translations(translation_text):
    """Extract translations from the markdown table."""
    if not translation_text:
        return []
        
    translations = []
    lines = translation_text.strip().split('\n')
    
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
            translations.append(line)
    
    return translations

def save_progress(completed_batches, failed_batches):
    """Save progress to allow resuming the translation."""
    with file_lock:
        progress = {
            "timestamp": time.time(),
            "completed_batches": completed_batches,
            "failed_batches": failed_batches
        }
        with open(PROGRESS_FILE, 'w', encoding='utf-8') as f:
            json.dump(progress, f, indent=2)

def load_progress():
    """Load progress from previous run or reconstruct from available files."""
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Error loading progress file: {e}")
    
    # If progress file is missing or invalid, reconstruct from raw files
    logger.info("Reconstructing progress from raw translation files...")
    completed_batches = []
    batch_id = 0
    
    # Find all raw translation files to determine which batches are complete
    raw_files = list(RAW_OUTPUT_DIR.glob("raw_translation_*.txt"))
    
    for raw_file in raw_files:
        try:
            # Extract line range from filename
            filename = raw_file.name
            match = re.search(r'raw_translation_(\d+)_(\d+)\.txt', filename)
            if not match:
                continue
                
            start_line = int(match.group(1))
            end_line = int(match.group(2))
            
            # Read raw file content
            with open(raw_file, 'r', encoding='utf-8') as f:
                content = f.read()
            
            batch_id += 1
            completed_batches.append({
                "batch_id": batch_id,
                "start_line": start_line,
                "end_line": end_line,
                "content": content,
                "success": True
            })
            
        except Exception as e:
            logger.warning(f"Error processing raw file {raw_file}: {e}")
    
    logger.info(f"Reconstructed progress for {len(completed_batches)} batches from raw files")
    return {"completed_batches": completed_batches, "failed_batches": []}

def append_to_output(translations):
    """Append translations to the output file in a thread-safe way."""
    with file_lock:
        with open(OUTPUT_FILE, 'a', encoding='utf-8') as out_file:
            for row in translations:
                out_file.write(f"{row}\n")

def process_batch(batch_id, start_line, end_line, total_lines, previous_batches=None):
    """Process a single batch of lines."""
    # Get lines to translate
    lines_to_translate = read_lines(SOURCE_FILE, start_line, end_line)
    
    # Get context before (from translated file or previous batches)
    context_before = []
    if start_line > 1:
        try:
            # First try to get context from previous batches (in memory)
            if previous_batches and len(previous_batches) > 0:
                # Find the most recent previous batch that has been processed
                prev_batch_lines = []
                for prev_batch in sorted(previous_batches, key=lambda x: x["end_line"], reverse=True):
                    if prev_batch["end_line"] < start_line:
                        prev_translations = extract_translations(prev_batch["content"])
                        prev_batch_lines.extend(prev_translations)
                        if len(prev_batch_lines) >= CONTEXT_BEFORE:
                            break
                
                context_before = prev_batch_lines[-CONTEXT_BEFORE:] if prev_batch_lines else []
            
            # If we couldn't get enough context from previous batches, read from file
            if len(context_before) < CONTEXT_BEFORE:
                with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
                    all_lines = f.readlines()
                    # Skip the header (first 2 lines)
                    file_context = [line.strip() for line in all_lines[2:] if line.strip()][-CONTEXT_BEFORE:]
                    # Add additional context from file
                    remaining_context = CONTEXT_BEFORE - len(context_before)
                    context_before = file_context[-remaining_context:] + context_before
        except Exception as e:
            logger.warning(f"Error getting context before: {e}")
    
    # Get context after (from source file)
    context_after = []
    if end_line < total_lines:
        context_after = read_lines(SOURCE_FILE, end_line + 1, min(end_line + CONTEXT_AFTER, total_lines))
    
    # Introduce a small delay to prevent rate limiting
    time.sleep(RATE_LIMIT_DELAY)
    
    # Translate current batch
    result = translate_batch(batch_id, lines_to_translate, context_before, context_after, start_line)
    
    if result["success"]:
        # Extract translations
        translations = extract_translations(result["content"])
        
        if translations:
            # Store translations in the result object
            result["translations"] = translations
            
            # Write this batch directly to file for real-time updates
            with file_lock:
                # First check if output file exists and has header
                if not OUTPUT_FILE.exists() or OUTPUT_FILE.stat().st_size == 0:
                    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_file:
                        out_file.write("| **Sanskrit** | **English Translation** |\n")
                        out_file.write("|-------------|-------------------------|\n")
                
                # Now append the translations
                temp_translations_file = Path(str(OUTPUT_FILE) + ".temp")
                
                # First read existing content
                existing_content = []
                try:
                    with open(OUTPUT_FILE, 'r', encoding='utf-8') as in_file:
                        existing_content = in_file.readlines()
                except Exception as e:
                    logger.warning(f"Error reading existing translations: {e}")
                    # Ensure we at least have headers
                    existing_content = ["| **Sanskrit** | **English Translation** |\n", 
                                       "|-------------|-------------------------|\n"]
                
                # Now insert new translations in the right position
                try:
                    # Extract line numbers for sorting
                    new_lines = []
                    for trans in translations:
                        line_num = extract_line_number(trans)
                        new_lines.append((line_num, trans))
                    
                    # Combine existing content with new translations
                    combined_lines = []
                    header = existing_content[:2]  # First two lines are header
                    content = existing_content[2:]  # Rest is content
                    
                    # Extract line numbers from existing content
                    existing_with_line_nums = []
                    for line in content:
                        line = line.strip()
                        if line:
                            line_num = extract_line_number(line)
                            existing_with_line_nums.append((line_num, line))
                    
                    # Combine and sort
                    all_lines = existing_with_line_nums + new_lines
                    all_lines.sort(key=lambda x: x[0])
                    
                    # Write back to file
                    with open(temp_translations_file, 'w', encoding='utf-8') as out_file:
                        # Write header
                        for line in header:
                            out_file.write(line)
                        
                        # Write content
                        for _, line in all_lines:
                            out_file.write(f"{line}\n")
                    
                    # Replace original file with temp file
                    temp_translations_file.replace(OUTPUT_FILE)
                    
                except Exception as e:
                    logger.warning(f"Error updating translations file in real-time: {e}")
                    # Fallback to simple append
                    with open(OUTPUT_FILE, 'a', encoding='utf-8') as out_file:
                        for row in translations:
                            out_file.write(f"{row}\n")
            
            logger.info(f"Completed batch {batch_id}: lines {start_line} to {end_line}")
        else:
            logger.warning(f"No translations extracted for batch {batch_id}: lines {start_line} to {end_line}")
    else:
        logger.error(f"Failed batch {batch_id}: lines {start_line} to {end_line}")
    
    return result

def detect_and_fill_translation_gaps():
    """Detect gaps in translation output and fill them from raw files."""
    logger.info("Checking for gaps in translation output...")
    
    # First get the line numbers from the current output file
    translated_lines = set()
    
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            content = f.readlines()
            
            for line in content:
                line_match = re.search(r'Line (\d+):', line)
                if line_match:
                    translated_lines.add(int(line_match.group(1)))
    except Exception as e:
        logger.warning(f"Error reading translated lines: {e}")
        # If we can't read the file, just continue with raw file processing
    
    # Find all raw translation files
    raw_files = list(RAW_OUTPUT_DIR.glob("raw_translation_*.txt"))
    logger.info(f"Found {len(raw_files)} raw translation files to check")
    
    # Extract all available translations from raw files
    all_translations = []
    missing_count = 0
    
    for raw_file in tqdm(raw_files, desc="Checking raw files for missing translations"):
        try:
            # Extract line range from filename
            filename = raw_file.name
            match = re.search(r'raw_translation_(\d+)_(\d+)\.txt', filename)
            if not match:
                continue
                
            start_line = int(match.group(1))
            end_line = int(match.group(2))
            
            # Check if any lines in this range are missing from the output
            has_missing_lines = False
            for line_num in range(start_line, end_line + 1):
                if line_num not in translated_lines:
                    has_missing_lines = True
                    missing_count += 1
                    break
            
            # If no missing lines in this batch, skip processing it
            if not has_missing_lines:
                continue
                
            # Read raw file content and extract translations
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
                        # Only add if it's missing from translated lines
                        if line_num not in translated_lines:
                            all_translations.append((line_num, line))
                    else:
                        # For blank lines - check if in range of missing lines
                        estimated_line = start_line + len(table_rows)
                        if estimated_line not in translated_lines:
                            all_translations.append((estimated_line, line))
                    table_rows.append(line)
        except Exception as e:
            logger.warning(f"Error processing file {raw_file} for gap filling: {e}")
    
    if not all_translations:
        logger.info("No missing translations found to fill in gaps.")
        return False
        
    # Sort translations by line number
    all_translations.sort(key=lambda x: x[0])
    
    logger.info(f"Found {len(all_translations)} missing translations to fill {missing_count} gaps")
    
    # Now update the output file with the missing translations
    try:
        # Read existing content
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            existing_content = f.readlines()
        
        # Extract line numbers and content
        header = existing_content[:2]  # First two lines are header
        existing_with_line_nums = []
        
        for line in existing_content[2:]:
            if line.strip():
                line_num = extract_line_number(line.strip())
                existing_with_line_nums.append((line_num, line.strip()))
        
        # Combine existing with missing translations
        combined = existing_with_line_nums + all_translations
        combined.sort(key=lambda x: x[0])
        
        # Write back to file
        temp_translations_file = Path(str(OUTPUT_FILE) + ".temp")
        with open(temp_translations_file, 'w', encoding='utf-8') as out_file:
            # Write header
            for line in header:
                out_file.write(line)
            
            # Write content
            for _, line in combined:
                out_file.write(f"{line}\n")
        
        # Replace original file with temp file
        temp_translations_file.replace(OUTPUT_FILE)
        
        logger.info(f"Successfully filled translation gaps in the output file")
        return True
    except Exception as e:
        logger.error(f"Error filling translation gaps: {e}")
        return False

def process_mahabharata():
    """Process the entire Mahabharata text in batches with multithreading."""
    # Get total lines
    total_lines = count_lines(SOURCE_FILE)
    logger.info(f"Total lines to process: {total_lines}")
    
    # Load progress from previous run
    progress = load_progress()
    completed_batch_ids = [b["batch_id"] for b in progress["completed_batches"]]
    
    # Find the highest line number already translated
    highest_line = 0
    for batch in progress["completed_batches"]:
        if batch["end_line"] > highest_line:
            highest_line = batch["end_line"]
    
    logger.info(f"Loaded {len(progress['completed_batches'])} completed batches from previous run")
    logger.info(f"Highest line already translated: {highest_line}")
    
    # Initialize the output file if starting fresh
    if not OUTPUT_FILE.exists() or OUTPUT_FILE.stat().st_size == 0:
        with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_file:
            out_file.write("| **Sanskrit** | **English Translation** |\n")
            out_file.write("|-------------|-------------------------|\n")
    
    # Create a list of batch ranges to process - simply continue from highest line
    batch_ranges = []
    batch_id = len(progress['completed_batches']) + 1
    
    # Start from the highest line translated + 1 for regular processing
    start_from_line = highest_line + 1 if highest_line > 0 else 1
    
    for start_line in range(start_from_line, total_lines + 1, BATCH_SIZE):
        end_line = min(start_line + BATCH_SIZE - 1, total_lines)
        batch_ranges.append((batch_id, start_line, end_line))
        batch_id += 1
    
    logger.info(f"Remaining batches to process: {len(batch_ranges)}")
    
    # Track batch results
    results = []
    completed_batches = progress["completed_batches"]
    failed_batches = progress["failed_batches"]
    
    # Process batches with multithreading
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            # Submit all batch tasks
            future_to_batch = {
                executor.submit(process_batch, batch_id, start_line, end_line, total_lines, completed_batches): 
                (batch_id, start_line, end_line) 
                for batch_id, start_line, end_line in batch_ranges
            }
            
            # Process results as they complete
            with tqdm(total=len(batch_ranges), desc="Translating batches") as progress_bar:
                for future in concurrent.futures.as_completed(future_to_batch):
                    batch_id, start_line, end_line = future_to_batch[future]
                    try:
                        result = future.result()
                        if result["success"]:
                            completed_batches.append(result)
                            logger.info(f"Completed batch {batch_id}: lines {start_line} to {end_line}")
                        else:
                            failed_batches.append(result)
                            logger.warning(f"Failed batch {batch_id}: lines {start_line} to {end_line}")
                        
                        # Save progress after each batch for greater reliability
                        save_progress(completed_batches, failed_batches)
                            
                        # Update output file after each batch
                        logger.info("Updating output file with current translations...")
                        write_translations_to_file(completed_batches)
                            
                    except Exception as e:
                        logger.error(f"Exception processing batch {batch_id}: {e}")
                        failed_batches.append({
                            "batch_id": batch_id,
                            "start_line": start_line,
                            "end_line": end_line,
                            "success": False,
                            "error": str(e)
                        })
                    
                    progress_bar.update(1)
                    
    except KeyboardInterrupt:
        logger.info("\nKeyboard interrupt detected. Saving progress and exiting gracefully...")
        # Save progress before exiting
        save_progress(completed_batches, failed_batches)
        
        # Write completed translations to file
        write_translations_to_file(completed_batches)
        
        logger.info(f"Progress saved. Processed {len(completed_batches)} batches so far.")
        logger.info(f"Resume later by running the script again.")
        return

def write_translations_to_file(completed_batches):
    """Write all translations to the output file in proper sequential order."""
    logger.info("Writing all translations to output file in sequential order...")
    
    # Clear existing output file (keep only the header)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_file:
        out_file.write("| **Sanskrit** | **English Translation** |\n")
        out_file.write("|-------------|-------------------------|\n")
    
    # Sort completed batches by start line and write translations in order
    for batch in tqdm(sorted(completed_batches, key=lambda x: x["start_line"]), desc="Writing translations"):
        # Extract translations if not already in the batch
        if "translations" not in batch or not batch["translations"]:
            batch["translations"] = extract_translations(batch["content"])
            
        if batch["translations"]:
            append_to_output(batch["translations"])
            
    # Check if we need to auto-fix
    if AUTO_FIX_TRANSLATIONS:
        # If translations were written from completed batches, we don't need to fix
        # The fix_translations_in_place function will be used when process is interrupted
        pass

def fix_translations_in_place():
    """Fix the order of translations in the output file."""
    logger.info("Fixing translation order in the output file...")
    
    # Get all raw translation files
    raw_files = list(RAW_OUTPUT_DIR.glob("raw_translation_*.txt"))
    logger.info(f"Found {len(raw_files)} raw translation files to process")
    
    # Extract line numbers and content from raw files
    translations = []
    
    for raw_file in tqdm(raw_files, desc="Processing raw files"):
        try:
            # Extract line range from filename
            filename = raw_file.name
            match = re.search(r'raw_translation_(\d+)_(\d+)\.txt', filename)
            if not match:
                logger.warning(f"Skipping file with invalid name format: {filename}")
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
            logger.warning(f"Error processing file {raw_file}: {e}")
    
    # Sort translations by line number
    translations.sort(key=lambda x: x[0])
    
    # Write to output file
    logger.info(f"Writing {len(translations)} translations to output file")
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out_file:
        out_file.write("| **Sanskrit** | **English Translation** |\n")
        out_file.write("|-------------|-------------------------|\n")
        
        for _, line in translations:
            out_file.write(f"{line}\n")
    
    logger.info("Translation output file has been reordered correctly")

def extract_line_number(line):
    """Extract line number from a table row."""
    match = re.search(r'Line (\d+):', line)
    if match:
        return int(match.group(1))
    return 0

def find_missing_lines(total_lines, output_file):
    """Find missing line numbers in the output file."""
    logger.info("Finding missing lines in translation output...")
    
    # Get all line numbers from the current output file
    translated_lines = set()
    
    try:
        with open(output_file, 'r', encoding='utf-8') as f:
            content = f.readlines()
            
            for line in content:
                line_match = re.search(r'Line (\d+):', line)
                if line_match:
                    translated_lines.add(int(line_match.group(1)))
    except Exception as e:
        logger.warning(f"Error reading translated lines: {e}")
        return set(range(1, total_lines + 1))  # Return all lines as missing if we can't read the file
    
    # Determine missing lines (all lines from 1 to total_lines that aren't in translated_lines)
    all_lines = set(range(1, total_lines + 1))
    missing_lines = all_lines - translated_lines
    
    # Print some statistics about missing lines
    if missing_lines:
        logger.info(f"Found {len(missing_lines)} missing lines out of {total_lines} total lines")
        
        # Check if target gaps are in the missing lines
        for start_gap, end_gap in TARGET_GAPS:
            gap_lines = set(range(start_gap, end_gap + 1))
            missing_in_gap = gap_lines.intersection(missing_lines)
            if missing_in_gap:
                logger.info(f"Gap {start_gap}-{end_gap} has {len(missing_in_gap)} missing lines")
            else:
                logger.info(f"Gap {start_gap}-{end_gap} is fully translated")
    
    return missing_lines

if __name__ == "__main__":
    if not os.getenv("ANTHROPIC_API_KEY"):
        logger.error("Error: ANTHROPIC_API_KEY not found in environment variables or .env file")
        exit(1)
    
    try:
        logger.info("Starting standard Mahabharata translation...")
        logger.info("Press Ctrl+C at any time to save progress and exit gracefully")
        logger.info(f"Running with controlled speed to prevent rate limits")
        logger.info(f"Using {MAX_WORKERS} worker, {RATE_LIMIT_DELAY}s delay, {BATCH_SIZE} lines per batch")
        
        process_mahabharata()
        logger.info("Translation process finished")
    except KeyboardInterrupt:
        logger.info("\nKeyboard interrupt detected in main thread. Exiting.")
    except Exception as e:
        logger.error(f"Unhandled exception: {e}")
        import traceback
        logger.error(traceback.format_exc())