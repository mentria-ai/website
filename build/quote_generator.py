import os
import json
import base64
import time
import signal
import sys
import subprocess
import re
from pathlib import Path
import random
from dotenv import load_dotenv
from together import Together

# Load environment variables
load_dotenv()

# Initialize Together API client
client = Together()

# Handle Ctrl+C to immediately exit
def signal_handler(sig, frame):
    print("\nCtrl+C detected! Exiting...")
    sys.exit(0)

# Register the signal handler
signal.signal(signal.SIGINT, signal_handler)

def load_existing_facts():
    """Load existing facts from the directory.json file if it exists."""
    json_path = Path("assets/data/directory.json")
    if json_path.exists():
        with open(json_path, "r") as f:
            return json.load(f)
    return {"quotes": []}

def get_highest_quote_number(quotes_data):
    """Find the highest quote number in the existing quotes data."""
    highest_num = 0
    for quote in quotes_data["quotes"]:
        if "id" in quote and quote["id"].startswith("quote_"):
            try:
                num = int(quote["id"].split("_")[1])
                highest_num = max(highest_num, num)
            except (ValueError, IndexError):
                # If ID format is unexpected, just ignore it
                pass
    return highest_num

def save_facts(facts_data):
    """Save facts data to the directory.json file."""
    json_path = Path("assets/data/directory.json")
    
    # Save the facts data
    with open(json_path, "w") as f:
        json.dump(facts_data, f, indent=2)
    print(f"Saved {len(facts_data['quotes'])} comic panels to {json_path}")

def git_commit_and_push(num_new_facts):
    """Commit the latest changes and push to the repository."""
    try:
        print("\nCommitting and pushing changes to the repository...")
        
        # Stage the changes
        subprocess.run(["git", "add", "assets/data/directory.json", "assets/img/quotes/"], check=True)
        
        # Create a descriptive commit message
        commit_message = f"Add {num_new_facts} new Mahabharata comic panels with Ghibli art"
        subprocess.run(["git", "commit", "-m", commit_message], check=True)
        
        # Push to the repository (assuming 'main' branch)
        subprocess.run(["git", "push", "origin", "main"], check=True)
        
        print("✓ Successfully committed and pushed new comic panels to the repository!")
    except subprocess.CalledProcessError as e:
        print(f"Error during Git operations: {e}")
    except Exception as e:
        print(f"Unexpected error during Git operations: {e}")

class MahabharataReader:
    def __init__(self, file_path="assets/data/reference/mahabharat_translated.txt"):
        self.file_path = Path(file_path)
        self.current_line = 0
        self.total_lines = 0
        self.lines = []
        self.load_file()
        self.previous_prompts = []  # Store previous image prompts for continuity
        self.comic_context = {      # Store context about scenes, characters, and settings
            "current_scene": "Unknown",
            "main_characters": [],
            "setting": "Ancient India",
            "time_of_day": "Day",
            "color_palette": "Warm earth tones with golden highlights"
        }
    
    def load_file(self):
        """Load the Mahabharata file and count lines."""
        if not self.file_path.exists():
            print(f"Error: Mahabharata file not found at {self.file_path}")
            return False
        
        with open(self.file_path, 'r', encoding='utf-8', errors='ignore') as file:
            self.lines = file.readlines()
        
        self.total_lines = len(self.lines)
        print(f"Loaded Mahabharata file with {self.total_lines} lines")
        return True
    
    def get_next_chunk(self, chunk_size=40):
        """Get the next sequential chunk of the text."""
        if self.current_line >= self.total_lines:
            print("Reached the end of the Mahabharata file. Restarting from the beginning.")
            self.current_line = 0
        
        # Calculate end of this chunk
        end_line = min(self.current_line + chunk_size, self.total_lines)
        
        # Process the lines in this chunk
        chunk_data = self.process_chunk(self.current_line, end_line)
        
        # Update the current line for next time
        self.current_line = end_line
        
        return chunk_data
    
    def process_chunk(self, start_line, end_line):
        """Process a chunk of the Mahabharata text."""
        sanskrit_lines = []
        english_lines = []
        line_numbers = []
        raw_content = []
        
        current_section = "Unknown"
        
        for i in range(start_line, end_line):
            line = self.lines[i].strip()
            
            # Skip empty lines
            if not line or "[Blank line]" in line:
                continue
                
            # Add to raw content for reference
            raw_content.append(line)
            
            # Check if it's a header or section marker
            if line.startswith('||') or (line.startswith('|') and '|' not in line[1:]):
                current_section = line.strip('|').strip()
                continue
                
            # Process the line if it's in tabular format
            if line.startswith('|') and '|' in line[1:]:
                columns = line.split('|')
                
                # Clean the columns (remove leading/trailing whitespace)
                columns = [col.strip() for col in columns if col.strip()]
                
                if len(columns) >= 2:
                    # First column usually contains Sanskrit or line numbers
                    sanskrit_col = columns[0]
                    
                    # Check if it's a line number
                    line_num_match = re.search(r'`Line (\d+):', sanskrit_col)
                    if line_num_match:
                        line_numbers.append(int(line_num_match.group(1)))
                        sanskrit_text = sanskrit_col.replace(f'`Line {line_num_match.group(1)}:', '').strip()
                        if sanskrit_text:
                            sanskrit_lines.append(sanskrit_text)
                    else:
                        sanskrit_lines.append(sanskrit_col)
                    
                    # Second column is the English translation
                    english_text = columns[1]
                    # Remove quotes if present
                    if english_text.startswith('"') and english_text.endswith('"'):
                        english_text = english_text[1:-1]
                    english_lines.append(english_text)
        
        return {
            "start_line": start_line,
            "end_line": end_line,
            "sanskrit_text": "\n".join(sanskrit_lines),
            "english_text": "\n".join(english_lines),
            "line_numbers": line_numbers,
            "raw_content": "\n".join(raw_content)
        }
    
    def update_comic_context(self, new_prompts):
        """Update the comic context based on recent prompts."""
        # Store the most recent prompts (up to 4)
        self.previous_prompts.extend(new_prompts)
        if len(self.previous_prompts) > 4:
            self.previous_prompts = self.previous_prompts[-4:]
        
        # If we have new prompts with scene information, update the context
        if new_prompts:
            # For simplicity, just use the latest prompt as context
            latest_prompt = new_prompts[-1]
            
            # Extract setting details if available (simplified example)
            if "setting:" in latest_prompt.lower():
                setting_match = re.search(r'setting: ([^\.]+)', latest_prompt, re.IGNORECASE)
                if setting_match:
                    self.comic_context["setting"] = setting_match.group(1)
            
            # Extract character details
            char_matches = re.findall(r'character: ([^,\.]+)', latest_prompt, re.IGNORECASE)
            if char_matches:
                for char in char_matches:
                    if char not in self.comic_context["main_characters"]:
                        self.comic_context["main_characters"].append(char)
            
            # Extract time of day if specified
            time_matches = re.search(r'time: (dawn|morning|noon|afternoon|evening|dusk|night)', 
                               latest_prompt, re.IGNORECASE)
            if time_matches:
                self.comic_context["time_of_day"] = time_matches.group(1)
        
        return self.comic_context

def generate_comic_frames(chunk_data, previous_prompts=None, comic_context=None, num_frames=4):
    """Generate comic book frames based on a chunk of the Mahabharata text."""
    
    # Ensure we have lists even if None was passed
    previous_prompts = previous_prompts or []
    comic_context = comic_context or {}
    
    # Create the system prompt
    system_prompt = """You are an expert at creating engaging, visually striking comic book frames based on ancient texts, paired with Ghibli Art style image prompts.

Transform this chunk of the Mahabharata into a 4-frame comic book sequence. Each frame should depict a key moment or concept from the text in a way that creates a coherent visual narrative. Your task is to analyze the content and create a sequential story told in 4 comic panels, with each panel focusing on a different aspect that together tell a complete micro-story.

Each frame MUST include:
1. A concise caption (15-40 words MAX) that narrates what's happening in that specific panel
2. A MINIMALIST Ghibli-style image prompt focused on depicting that moment with beauty and clarity
3. Specific details about character positions, expressions, and environmental elements

EXTREMELY IMPORTANT FOR IMAGE GENERATION SUCCESS:
- DO NOT use specific character names OR generic role descriptions like "young storyteller" or "elderly sage"
- Instead, use CONCRETE VISUAL DESCRIPTIONS focusing on physical appearance:
  * "A man with long dark hair and humble eyes dressed in simple robes" (not "a storyteller")
  * "A white-bearded man with weathered skin in ochre garments" (not "an elderly sage")
  * "A muscular figure with a royal bearing and ornate armor" (not "a warrior prince")
- Focus on exactly what the reader would visualize: clothing colors, facial features, body posture, etc.
- You can use specific character names in the caption text, just not in the image prompts

IMPORTANT REQUIREMENTS FOR EVERY IMAGE PROMPT:
1. Create a cohesive visual style across all 4 frames - maintain the same visual descriptions for recurring characters
2. Embrace the soft, painterly quality of Ghibli art with gentle lighting, atmospheric effects, and thoughtful composition
3. Focus on emotional storytelling through character expressions and meaningful interactions
4. Each frame should visually flow to the next, creating a sense of narrative movement
5. Use symbolic visual elements that connect to the deeper meaning of the text
6. Create images that match what a reader would visualize when reading the Mahabharata

FORMATTING REQUIREMENTS:
- Each image prompt should start with "Ghibli Art:" 
- Include specific details about character appearance, clothing, expressions, and key visual elements
- Specify a consistent time of day, weather, and lighting across frames to maintain continuity
- Describe the composition in terms of foreground, middle ground, and background elements
- Keep prompt length reasonable (40-80 words maximum) with clear, direct descriptions

Context for continuity: 
Consider the provided context about previous frames to maintain visual and narrative continuity between sequences. Your frames should feel like part of a larger, ongoing visual narrative.

IMPORTANT: Never refer to elements from the Mahabharata as "myths" or "mythical." Treat them as historical and cultural elements with reverence."""

    # Create the user prompt
    user_prompt = f"""Transform this section of the Mahabharata into a 4-frame comic book sequence with Ghibli Art style.

MAHABHARATA TEXT CHUNK:

SANSKRIT ORIGINAL:
```
{chunk_data['sanskrit_text']}
```

ENGLISH TRANSLATION:
```
{chunk_data['english_text']}
```

CONTEXT FOR CONTINUITY:
Previous scene setting: {comic_context.get('setting', 'Ancient India')}
Time of day: {comic_context.get('time_of_day', 'Day')}
Main characters: {', '.join(comic_context.get('main_characters', ['Unknown']))}
Color palette: {comic_context.get('color_palette', 'Warm earth tones with golden highlights')}

PREVIOUS IMAGE PROMPTS (for visual continuity):
{' '.join(previous_prompts[-2:]) if previous_prompts else 'None available yet.'}

Create a 4-panel comic sequence that tells a cohesive visual story based on this text chunk. The frames should flow together while each highlighting a different aspect or moment. Your frames will be presented in sequence, so ensure they create a meaningful narrative progression.

For each frame, provide:
1. A brief, direct caption (15-40 words) that narrates what's happening in this panel - you CAN use specific character names here
2. A SIMPLE but evocative Ghibli Art style image prompt that visualizes this moment - use SPECIFIC VISUAL DESCRIPTIONS
3. Key visual elements including character appearance, expressions, and environmental details

IMPORTANT GUIDELINES:
- Use detailed visual descriptions of characters in image prompts (physical features, clothing, expressions)
- Avoid generic terms like "sage", "storyteller", "warrior" - describe EXACTLY what they look like
- Create images that match what a reader would visualize when reading the Mahabharata
- Maintain visual continuity with previous prompts if available
- Create a cohesive art style across all 4 frames
- Focus on emotional storytelling through character expressions and interactions
- Use Ghibli's signature atmospheric elements (light shafts, wind effects, etc.)
- Balance simplicity with meaningful detail

Format your response as a valid JSON array with objects containing:
1. "caption": The narration for this panel (what would appear in a comic book caption box) - can use character names
2. "image_prompt": A Ghibli Art style image prompt focused on visualizing this specific moment - use detailed visual descriptions
3. "frame_number": The sequence number (1-4) of this frame
4. "sanskrit_reference": Brief reference to which part of the Sanskrit text inspired this frame
5. "panel_focus": The main focus/theme of this panel (e.g., "character introduction", "revelation", "conflict")

Example of good image prompt:
"Ghibli Art: A slender man with alert dark eyes and humble posture, dressed in simple orange robes, approaches a forest clearing. Men with flowing white beards and weathered faces sit in a semicircle, wearing earth-toned garments. Golden morning light filters through ancient trees, illuminating dust particles in the air."

Example of bad image prompt (don't do this):
"Ghibli Art: A young storyteller approaches a group of elderly sages in the forest. The sacred atmosphere surrounds them as sunlight filters through the trees."

Respond with only the JSON array, no additional text."""

    # Generate comic frames based on the Mahabharata chunk
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    print(f"Generating 4-frame comic sequence based on Mahabharata text (lines {chunk_data['start_line']}-{chunk_data['end_line']})...")
    
    response_text = ""
    response = client.chat.completions.create(
        model="deepseek-ai/DeepSeek-V3",
        messages=messages,
        max_tokens=4096,
        temperature=0.7,
        top_p=0.7,
        top_k=50,
        repetition_penalty=1,
        stop=["\n\n"],
        stream=True
    )
    
    for token in response:
        if hasattr(token, 'choices'):
            chunk = token.choices[0].delta.content
            if chunk:
                response_text += chunk
                print(chunk, end='', flush=True)
    
    print("\n\nParsing response...")
    
    # Extract JSON from response
    try:
        # Find JSON array in the response
        json_start = response_text.find('[')
        json_end = response_text.rfind(']') + 1
        
        if json_start >= 0 and json_end > json_start:
            json_str = response_text[json_start:json_end]
            comic_frames = json.loads(json_str)
        else:
            # Fallback if JSON array not found
            print("JSON array not found in response. Attempting to parse entire response...")
            comic_frames = json.loads(response_text)
            
        return comic_frames
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        print(f"Response text: {response_text}")
        return []

def review_image(image_path, prompt, original_text):
    """Review the generated image using the vision model to check if it matches the intended prompt."""
    try:
        # Read and encode the image file in base64
        with open(image_path, 'rb') as img_file:
            image_data = img_file.read()
            image_base64 = base64.b64encode(image_data).decode('utf-8')
            
        print("\n=== Vision Model Review ===")
        print(f"Reviewing image: {image_path}")
        
        # Create the system and user messages
        system_message = "You are an art critic reviewing Ghibli-style illustrations. Your task is to provide a simple numerical score and brief feedback."
        
        user_message = f"""Rate this image on two aspects:

1. Overall artistic feel and Ghibli style (10% of score)
2. Adherence to the prompt instructions (90% of score)

ORIGINAL PROMPT:
{prompt}

CONTEXT:
{original_text}

Please provide your review in this exact format:
<review>
    <artistic_score>X</artistic_score>
    <prompt_score>X</prompt_score>
    <total_score>X</total_score>
    <brief_feedback>One or two sentences of feedback</brief_feedback>
</review>

Where X is a number from 0-10. The total_score should be: (artistic_score * 0.1) + (prompt_score * 0.9)
Keep your feedback very brief and focused on the main points."""

        print("\n=== Complete Prompt Being Sent ===")
        print("SYSTEM MESSAGE:")
        print("-" * 50)
        print(system_message)
        print("-" * 50)
        print("\nUSER MESSAGE:")
        print("-" * 50)
        print(user_message)
        print("-" * 50)
        print("\nSending to vision model...")
            
        # Create the API request with base64 encoded image
        response = client.chat.completions.create(
            model="meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
            messages=[
                {
                    "role": "system",
                    "content": system_message
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": user_message
                        },
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{image_base64}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=1000,
            temperature=0.7
        )
        
        # Validate response structure
        if not hasattr(response, 'choices') or not response.choices:
            print("\n❌ Vision model returned an empty response")
            return None
            
        # Extract the response
        try:
            review_text = response.choices[0].message.content
            if not review_text:
                print("\n❌ Vision model returned empty content")
                return None
                
            print("\n=== Vision Model Response ===")
            print("Raw response:")
            print("-" * 50)
            print(review_text)
            print("-" * 50)
            
            # Clean up the response text - remove any text outside XML tags
            import re
            review_match = re.search(r'<review>.*?</review>', review_text, re.DOTALL)
            if not review_match:
                print("\n❌ No valid XML review tags found in response")
                return None
                
            review_text = review_match.group(0)
            print("\nExtracted XML:")
            print("-" * 50)
            print(review_text)
            print("-" * 50)
            
            # Extract scores and feedback
            artistic_score_match = re.search(r'<artistic_score>(.*?)</artistic_score>', review_text, re.DOTALL)
            prompt_score_match = re.search(r'<prompt_score>(.*?)</prompt_score>', review_text, re.DOTALL)
            total_score_match = re.search(r'<total_score>(.*?)</total_score>', review_text, re.DOTALL)
            feedback_match = re.search(r'<brief_feedback>(.*?)</brief_feedback>', review_text, re.DOTALL)
            
            if not all([artistic_score_match, prompt_score_match, total_score_match, feedback_match]):
                print("\n❌ Missing required review elements")
                return None
                
            # Convert scores to floats, with error handling
            try:
                artistic_score = float(artistic_score_match.group(1).strip())
                prompt_score = float(prompt_score_match.group(1).strip())
                total_score = float(total_score_match.group(1).strip())
                
                # Verify score ranges
                if not (0 <= artistic_score <= 10 and 0 <= prompt_score <= 10 and 0 <= total_score <= 10):
                    print("\n⚠️ Score values out of range (0-10), clamping...")
                    artistic_score = max(0, min(10, artistic_score))
                    prompt_score = max(0, min(10, prompt_score))
                    total_score = max(0, min(10, total_score))
            except ValueError:
                print("\n❌ Error converting scores to numbers")
                print(f"Artistic score: {artistic_score_match.group(1).strip()}")
                print(f"Prompt score: {prompt_score_match.group(1).strip()}")
                print(f"Total score: {total_score_match.group(1).strip()}")
                return None
                
            feedback = feedback_match.group(1).strip()
            
            print("\n=== Review Results ===")
            print(f"Artistic Score: {artistic_score}/10")
            print(f"Prompt Score: {prompt_score}/10")
            print(f"Total Score: {total_score}/10")
            print(f"Feedback: {feedback}")
            print("=" * 50)
            
            # Return scores and feedback
            return {
                "artistic_score": artistic_score,
                "prompt_score": prompt_score,
                "total_score": total_score,
                "feedback": feedback,
                "verdict": "YES" if total_score >= 7.0 else "NO"  # Consider 7.0 as passing threshold
            }
            
        except (AttributeError, IndexError, ValueError) as e:
            print(f"\n❌ Error parsing vision model response: {e}")
            print("Raw response:")
            print("-" * 50)
            print(review_text)
            print("-" * 50)
            return None
        
    except Exception as e:
        print(f"\n❌ Error during image review: {e}")
        print("Attempting to continue with generation...")
        return None

def store_review_in_directory(image_path, review_result):
    """Store the review scores in the directory.json file for the corresponding quote."""
    try:
        print("\n=== Storing Review in Directory ===")
        
        # Load the existing facts data
        facts_data = load_existing_facts()
        
        # Extract the image filename from the path
        image_filename = os.path.basename(image_path)
        expected_image_url = f"assets/img/quotes/{image_filename}"
        
        print(f"Looking for quote with image_url: {expected_image_url}")
        
        # Find the quote with the matching image URL
        matching_quotes = [q for q in facts_data["quotes"] if q["image_url"] == expected_image_url]
        
        if not matching_quotes:
            print(f"❌ No matching quote found for image {image_filename}")
            print("Quotes in directory:")
            for i, quote in enumerate(facts_data["quotes"][-5:]):  # Show last 5 quotes
                print(f"  {i}. id: {quote['id']}, image_url: {quote['image_url']}")
            return False
        
        # Update the quote with the review scores
        quote = matching_quotes[0]
        print(f"✓ Found matching quote: {quote['id']}")
        
        quote["review_scores"] = {
            "artistic_score": review_result["artistic_score"],
            "prompt_score": review_result["prompt_score"],
            "total_score": review_result["total_score"],
            "feedback": review_result["feedback"]
        }
        
        print("✓ Added review scores to quote")
        
        # Save the updated facts data
        save_facts(facts_data)
        print("✓ Saved updated directory.json file")
        
        return True
        
    except Exception as e:
        print(f"❌ Error storing review in directory: {e}")
        return False

def generate_and_save_image(prompt, image_path, previous_image_path=None, guidance=5.5, test_guidance=False, test_continuity=False, original_text=None):
    """Generate an image using the provided prompt and save it to the specified path."""
    max_attempts = 3  # Maximum number of attempts to generate a satisfactory image
    review_results = None  # Store review results for later use
    
    for attempt in range(max_attempts):
        current_prompt = prompt  # Use the original prompt for first attempt
        
        if test_continuity and previous_image_path:
            # Test both with and without previous image reference
            print("\nTesting image generation with and without previous image reference...")
            
            # Generate base filename and path
            base_path = image_path.rsplit('.', 1)[0]  # Remove extension
            
            # Generate version without previous image reference
            no_ref_path = f"{base_path}_no_ref.png"
            success_no_ref = generate_image_with_params(
                current_prompt, 
                no_ref_path,
                previous_image_path=None,  # Explicitly not using previous image
                guidance=guidance
            )
            if success_no_ref:
                print("Generated version without previous image reference")
            
            # Generate version with previous image reference
            with_ref_path = f"{base_path}_with_ref.png"
            success_with_ref = generate_image_with_params(
                current_prompt, 
                with_ref_path,
                previous_image_path=previous_image_path,
                guidance=guidance
            )
            if success_with_ref:
                print("Generated version with previous image reference")
            
            if success_no_ref and success_with_ref:
                # Ask user to select the better version
                while True:
                    print("\nCompare the two versions:")
                    print("1: Without previous image reference")
                    print("2: With previous image reference")
                    selection = input("\nEnter the number of the better version (1/2): ").strip()
                    
                    if selection in ['1', '2']:
                        selected_path = no_ref_path if selection == '1' else with_ref_path
                        other_path = with_ref_path if selection == '1' else no_ref_path
                        
                        # Rename selected file to original name
                        os.rename(selected_path, image_path)
                        print(f"Selected version {selection} has been saved as {image_path}")
                        
                        # Delete the other version
                        if os.path.exists(other_path):
                            os.remove(other_path)
                        
                        return True, None  # Return success but no review results
                    else:
                        print("Invalid selection. Please enter 1 or 2.")
            
            return False, None
            
        elif test_guidance:
            # Define different guidance scales to test
            guidance_scales = [1.5, 3.5, 5.5, 7.5]
            test_images = []
            
            # Generate base filename and path
            base_path = image_path.rsplit('.', 1)[0]  # Remove extension
            
            print("\nGenerating test images with different guidance values...")
            
            # Generate images with different guidance values
            for idx, scale in enumerate(guidance_scales):
                test_path = f"{base_path}_{chr(97+idx)}.png"  # a, b, c, d suffixes
                success = generate_image_with_params(
                    current_prompt, 
                    test_path,
                    previous_image_path,
                    scale
                )
                if success:
                    test_images.append(test_path)
                    print(f"Generated test image {chr(97+idx)} with guidance={scale}")
            
            if test_images:
                # Ask user to select the best version
                while True:
                    print("\nGuidance values used:")
                    print(f"a: 1.5 (more creative)")
                    print(f"b: 3.5 (balanced)")
                    print(f"c: 5.5 (more faithful/default)")
                    print(f"d: 7.5 (very faithful)")
                    selection = input("\nEnter the letter (a/b/c/d) of the best image: ").lower()
                    if selection in ['a', 'b', 'c', 'd']:
                        selected_path = f"{base_path}_{selection}.png"
                        if os.path.exists(selected_path):
                            # Rename selected file to original name
                            os.rename(selected_path, image_path)
                            print(f"Selected image {selection} has been saved as {image_path}")
                            
                            # Delete other test images
                            for test_path in test_images:
                                if test_path != selected_path and os.path.exists(test_path):
                                    os.remove(test_path)
                            
                            return True, None  # Return success but no review results
                        else:
                            print(f"Error: Selected image {selection} not found.")
                    else:
                        print("Invalid selection. Please enter a, b, c, or d.")
            
            return False, None
            
        else:
            success = generate_image_with_params(current_prompt, image_path, previous_image_path, guidance)
            
            if success:
                print("\nReviewing generated image...")
                review_result = review_image(image_path, current_prompt, original_text)
                
                if review_result:
                    print(f"\nTotal Score: {review_result['total_score']}/10")
                    print(f"Feedback: {review_result['feedback']}")
                    
                    # Store review results for later use when creating the quote
                    review_results = review_result
                    
                    if review_result["verdict"] == "YES":
                        print("✓ Image meets quality threshold!")
                        return True, review_results
                    else:
                        if attempt < max_attempts - 1:  # If we still have attempts left
                            print("\nImage scored below threshold. Attempting regeneration...")
                            # Delete the rejected image
                            os.remove(image_path)
                        else:
                            print("\n✗ Maximum attempts reached. Using the last generated image.")
                            return True, review_results
                else:
                    print("Failed to review image. Using the generated image anyway.")
                    return True, None
            
            print(f"Attempt {attempt + 1} failed to generate image.")
    
    return False, None

def generate_image_with_params(prompt, image_path, previous_image_path=None, guidance=3.5):
    """Helper function to generate a single image with specified parameters."""
    try:
        print(f"Generating image for: {prompt[:50]}...")
        print(f"Using guidance value: {guidance} (type: {type(guidance)})")
        
        # Base parameters for image generation
        params = {
            "model": "black-forest-labs/FLUX.1-dev-lora", 
            "prompt": prompt,
            "width": 832,
            "height": 1440,
            "steps": 30,
            "n": 1,
            "response_format": "url",
            "guidance": float(guidance),
            "seed": 777,  # Added fixed seed for consistency
            "image_loras": [
                {"path": "https://huggingface.co/strangerzonehf/Flux-Ghibli-Art-LoRA/resolve/main/Ghibli-Art.safetensors", "scale": 1}
            ]
        }
        
        # If we have a previous image, use it as reference for continuity
        if previous_image_path and os.path.exists(previous_image_path):
            print(f"Using previous image {previous_image_path} as reference for continuity")
            params["image_url"] = previous_image_path
        
        print(f"API parameters: {params}")
        
        # Generate the image
        response = client.images.generate(**params)
        
        # Download and save the image from URL
        import requests
        img_response = requests.get(response.data[0].url)
        if img_response.status_code == 200:
            with open(image_path, 'wb') as f:
                f.write(img_response.content)
            print(f"Image saved to {image_path}")
            return True
            
        raise Exception(f"Failed to download image, status code: {img_response.status_code}")
    
    except Exception as e:
        print(f"Error generating image: {e}")
        return False

def main():
    # Create necessary directories
    os.makedirs("assets/img/quotes", exist_ok=True)
    os.makedirs("assets/data", exist_ok=True)
    
    print("===== Mahabharata Comic Generator =====")
    print("Press Ctrl+C to stop the program")
    print("=======================================")
    
    # Add test flags
    test_guidance = input("Do you want to test different guidance values? (y/n): ").lower() == 'y'
    test_continuity = input("Do you want to test with/without previous image reference? (y/n): ").lower() == 'y'
    
    # Initialize the Mahabharata reader
    mahabharata_reader = MahabharataReader()
    
    pause_duration = 300  # Seconds to pause between batches (5 minutes)
    batch_count = 0
    
    try:
        while True:
            batch_count += 1
            print(f"\n--- Starting Batch #{batch_count} ---")
            
            # Load existing facts (reload each time to ensure we have the latest)
            facts_data = load_existing_facts()
            
            # Find the highest quote number to continue from
            highest_quote_number = get_highest_quote_number(facts_data)
            print(f"Found highest existing quote number: {highest_quote_number}")
            print(f"Total frames in database: {len(facts_data['quotes'])}")
            
            # Get the next sequential chunk of text
            chunk_data = mahabharata_reader.get_next_chunk(chunk_size=40)
            
            if not chunk_data["english_text"]:
                print("Empty chunk encountered. Moving to the next section.")
                time.sleep(5)  # Short pause before trying again
                continue
            
            # Generate comic frames based on the chunk
            comic_frames = generate_comic_frames(
                chunk_data, 
                previous_prompts=mahabharata_reader.previous_prompts,
                comic_context=mahabharata_reader.comic_context
            )
            
            if not comic_frames:
                print("Failed to generate comic frames. Will try again after a pause.")
                time.sleep(pause_duration)
                continue
            
            # Track successfully processed frames for commit message
            successful_frames = 0
            new_prompts = []
            
            # Store the previous image path for continuity
            previous_image_path = None
            
            # Process each comic frame
            for i, frame in enumerate(comic_frames):
                # Generate a sequential ID based on the highest existing quote number
                next_quote_number = highest_quote_number + successful_frames + 1
                frame_id = f"quote_{next_quote_number}"  # Keep quote_ prefix for compatibility
                
                # Define image path
                image_filename = f"{frame_id}.png"
                image_path = f"assets/img/quotes/{image_filename}"
                image_url = f"assets/img/quotes/{image_filename}"
                
                # Check if this image already exists, skip if it does
                if os.path.exists(image_path):
                    print(f"Image {image_path} already exists, skipping...")
                    previous_image_path = image_path  # Set as previous for next iteration
                    continue
                
                # Store the prompt for continuity
                new_prompts.append(frame["image_prompt"])
                
                # Generate and save the image with original text context
                success, review_results = generate_and_save_image(
                    frame["image_prompt"], 
                    image_path,
                    previous_image_path=previous_image_path,
                    guidance=5.5,  # Updated default value
                    test_guidance=test_guidance,
                    test_continuity=test_continuity,
                    original_text=f"Caption: {frame['caption']}\nSanskrit Reference: {frame.get('sanskrit_reference', 'Not specified')}\nPanel Focus: {frame.get('panel_focus', 'storytelling')}"
                )
                
                # If successful, update previous_image_path for next frame
                if success:
                    previous_image_path = image_path
                
                # Add to data
                if success:
                    # Prepare the emphasis data (for compatibility)
                    emphasis = {}
                    # Extract key phrases for emphasis (simplified example)
                    words = frame["caption"].split()
                    if len(words) > 5:
                        # Emphasize a few key words for animation
                        key_word = words[len(words) // 2]  # Middle word
                        emphasis[key_word] = "emphasis-2"
                    
                    quote_data = {
                        "id": frame_id,
                        "quote": frame["caption"],
                        "image_prompt": frame["image_prompt"],
                        "image_url": image_url,
                        "emphasis": emphasis,
                        "context": f"Frame {frame.get('frame_number', i+1)} of a 4-panel sequence. " +
                                 f"Focus: {frame.get('panel_focus', 'storytelling')}. " +
                                 f"Based on lines {chunk_data['start_line']}-{chunk_data['end_line']} " +
                                 f"of the Mahabharata. Sanskrit reference: {frame.get('sanskrit_reference', 'Not specified')}"
                    }
                    
                    # Add review scores if available
                    if review_results:
                        quote_data["review_scores"] = {
                            "artistic_score": review_results["artistic_score"],
                            "prompt_score": review_results["prompt_score"],
                            "total_score": review_results["total_score"],
                            "feedback": review_results["feedback"]
                        }
                        print(f"✓ Added review scores to quote {frame_id}")
                    
                    # Add quote to facts data
                    facts_data["quotes"].append(quote_data)
                    
                    # Increment successful count
                    successful_frames += 1
            
            # Save after each successful image generation to preserve progress
            save_facts(facts_data)
            
            # Add a delay to avoid rate limiting
            time.sleep(2)
            
            # Update comic context with new prompts for continuity
            mahabharata_reader.update_comic_context(new_prompts)
            
            # If any frames were generated successfully, commit and push the changes
            if successful_frames > 0:
                git_commit_and_push(successful_frames)
            
            print(f"\nBatch #{batch_count} complete! Waiting 5 minutes before next batch...")
            print(f"(Press Ctrl+C to exit)")
            
            # Show a countdown timer during the wait
            remaining = pause_duration
            while remaining > 0:
                mins = remaining // 60
                secs = remaining % 60
                print(f"\rNext batch in: {mins:02d}:{secs:02d}", end="")
                time.sleep(1)
                remaining -= 1
            
            print("\rWait complete. Starting next batch...                ")
    
    except KeyboardInterrupt:
        # This should not be reached due to the signal handler, but added as a fallback
        print("\nComic generation stopped. Exiting...")
        sys.exit(0)

if __name__ == "__main__":
    main() 