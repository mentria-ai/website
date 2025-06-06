#!/usr/bin/env python3
"""
Process AI response and extract music parameters
"""
import json
import re
import sys
import os

def extract_response_content():
    """Extract content from API response"""
    try:
        with open('api_response.json', 'r', encoding='utf-8') as f:
            response = json.load(f)
        
        content = response.get('choices', [{}])[0].get('message', {}).get('content', '')
        
        if content:
            with open('response_content.txt', 'w', encoding='utf-8') as f:
                f.write(content)
            return content
        else:
            print("ERROR: No content found in response", file=sys.stderr)
            return None
            
    except Exception as e:
        print(f"ERROR: Failed to parse response: {e}", file=sys.stderr)
        return None

def extract_json_from_content(content):
    """Extract JSON from AI response content using multiple strategies"""
    json_text = None
    
    try:
        # Strategy 1: Look for JSON in markdown code blocks
        code_block = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', content, re.DOTALL)
        if code_block:
            potential_json = code_block.group(1)
            if 'style_prompt' in potential_json and 'lyrics' in potential_json:
                json_text = potential_json
        
        # Strategy 2: Find complete JSON object using bracket counting
        if not json_text:
            start = content.find('{')
            if start != -1:
                bracket_count = 0
                in_string = False
                escape_next = False
                for i, char in enumerate(content[start:], start):
                    if escape_next:
                        escape_next = False
                        continue
                    if char == '\\' and in_string:
                        escape_next = True
                        continue
                    if char == '"' and not escape_next:
                        in_string = not in_string
                        continue
                    if not in_string:
                        if char == '{':
                            bracket_count += 1
                        elif char == '}':
                            bracket_count -= 1
                            if bracket_count == 0:
                                potential_json = content[start:i+1]
                                if 'style_prompt' in potential_json:
                                    json_text = potential_json
                                break
        
        # Strategy 3: Simple fallback to first { and last }
        if not json_text:
            start = content.find('{')
            end = content.rfind('}') + 1
            if start != -1 and end > start:
                potential_json = content[start:end]
                if 'style_prompt' in potential_json:
                    json_text = potential_json
        
        if json_text:
            try:
                print(f"DEBUG: Attempting to parse JSON of length {len(json_text)}", file=sys.stderr)
                data = json.loads(json_text)
                if 'style_prompt' in data and 'lyrics' in data:
                    with open('extracted_json.json', 'w', encoding='utf-8') as f:
                        json.dump(data, f, indent=2)
                    return data
                else:
                    print(f"DEBUG: JSON missing required fields. Has: {list(data.keys())}", file=sys.stderr)
            except Exception as e:
                print(f"DEBUG: JSON parsing failed: {e}", file=sys.stderr)
        
        # Fallback if no valid JSON found
        print('DEBUG: No valid JSON found, using uplifting instrumental fallback', file=sys.stderr)
        fallback = {
            'style_prompt': 'ambient, peaceful, uplifting, gentle',
            'lyrics': '[inst]',
            'duration': 120,
            'title_suggestion': 'Peaceful Moments',
            'inspiration': 'Calming instrumental music for relaxation and focus'
        }
        with open('extracted_json.json', 'w', encoding='utf-8') as f:
            json.dump(fallback, f, indent=2)
        return fallback
        
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return None

def extract_and_validate_parameters():
    """Extract and validate parameters from JSON"""
    try:
        with open('extracted_json.json', 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract parameters with fallbacks
        style_prompt = data.get('style_prompt', 'electronic, ambient, melodic')
        lyrics = data.get('lyrics', '[inst]')
        duration = data.get('duration', 90)
        title_suggestion = data.get('title_suggestion', 'AI Generated Track')
        inspiration = data.get('inspiration', 'Automatically generated music')
        seed = data.get('seed', None)
        
        # Validate duration (optimized for instrumental wellness music)
        valid_durations = [60, 90, 120, 150, 180]
        if duration not in valid_durations:
            duration = 120
        
        # Clean parameters and limit length appropriately
        style_prompt = str(style_prompt).strip()[:400]
        lyrics = str(lyrics).strip()[:4000]  # Allow much longer lyrics (4000 chars)
        title_suggestion = str(title_suggestion).strip()[:100]  # Slightly longer titles
        inspiration = str(inspiration).strip()[:300]
        
        # Remove only surrounding quotes, preserve internal quotes in lyrics
        if style_prompt.startswith('"') and style_prompt.endswith('"'):
            style_prompt = style_prompt[1:-1]
        if title_suggestion.startswith('"') and title_suggestion.endswith('"'):
            title_suggestion = title_suggestion[1:-1]
        if inspiration.startswith('"') and inspiration.endswith('"'):
            inspiration = inspiration[1:-1]
        # Don't modify lyrics quotes - they might be part of the song content
        
        # Validate seed if provided
        if seed is not None:
            try:
                seed = int(seed)
                if seed < 0 or seed > 4294967295:
                    seed = None
            except:
                seed = None
        
        # Write parameters to file for shell script consumption
        with open('music_parameters.txt', 'w', encoding='utf-8') as f:
            f.write(f"STYLE_PROMPT={style_prompt}\n")
            f.write(f"LYRICS={lyrics}\n")
            f.write(f"DURATION={duration}\n")
            f.write(f"TITLE_SUGGESTION={title_suggestion}\n")
            f.write(f"INSPIRATION={inspiration}\n")
            f.write(f"SEED={seed if seed is not None else ''}\n")
            f.write("SUCCESS=true\n")
        
        print("✅ Parameters extracted and validated successfully")
        return True
        
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        with open('music_parameters.txt', 'w', encoding='utf-8') as f:
            f.write("SUCCESS=false\n")
        return False

def main():
    """Main function"""
    # Extract content from API response
    content = extract_response_content()
    if not content:
        sys.exit(1)
    
    # Extract JSON from content
    json_data = extract_json_from_content(content)
    if not json_data:
        sys.exit(1)
    
    # Extract and validate parameters
    success = extract_and_validate_parameters()
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main() 