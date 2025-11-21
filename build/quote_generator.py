import os
import json
import base64
import time
import signal
import sys
import subprocess
import re
import requests
import uuid
from pathlib import Path
import random
from dotenv import load_dotenv
from together import Together
from PIL import Image
import datetime
import urllib.request

# Load environment variables
load_dotenv()

# Initialize Together API client (we'll keep this for generating prompts)
client = Together()

# ComfyUI RunPod configuration - load from .env file or use default
COMFY_API_URL = os.getenv('COMFY_API_URL', 'https://dbc6kcfozwpt1i-8188.proxy.runpod.net')
if not COMFY_API_URL:
    print("WARNING: COMFY_API_URL not found in .env file. Using default URL.")
    COMFY_API_URL = 'https://dbc6kcfozwpt1i-8188.proxy.runpod.net'
    
print(f"Using ComfyUI API URL: {COMFY_API_URL}")

client_id = str(uuid.uuid4())  # Generate a unique client ID for this session

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
    print(f"Saved {len(facts_data['quotes'])} quotes to {json_path}")

def git_commit_and_push(num_new_facts):
    """Commit the latest changes and push to the repository."""
    try:
        print("\nCommitting and pushing changes to the repository...")
        
        # Stage the changes
        subprocess.run(["git", "add", "assets/data/directory.json", "assets/img/quotes/", "assets/audio/quotes/"], check=True)
        
        # Create a descriptive commit message
        commit_message = f"Add {num_new_facts} new Mahabharata lore quote{'s' if num_new_facts > 1 else ''} with e-ink style artwork and audio"
        subprocess.run(["git", "commit", "-m", commit_message], check=True)
        
        # Push to the repository (assuming 'main' branch)
        subprocess.run(["git", "push", "origin", "main"], check=True)
        
        print("✓ Successfully committed and pushed new lore quotes to the repository!")
    except subprocess.CalledProcessError as e:
        print(f"Error during Git operations: {e}")
    except Exception as e:
        print(f"Unexpected error during Git operations: {e}")

class MahabharataReader:
    def __init__(self, file_path="assets/data/reference/mahabharat_translated.txt"):
        self.file_path = Path(file_path)
        self.progress_file = Path("assets/data/.last_read_line")
        self.current_line = 0
        self.total_lines = 0
        self.lines = []
        self.load_file()
        self.load_progress()
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
    
    def load_progress(self):
        """Load the last read line from the progress file."""
        if self.progress_file.exists():
            try:
                with open(self.progress_file, 'r') as f:
                    line_number = int(f.read().strip())
                    # Ensure it's a valid line number
                    if 0 <= line_number < self.total_lines:
                        self.current_line = line_number
                        print(f"Resuming from line {self.current_line} (saved progress)")
                    else:
                        print(f"Invalid line number in progress file: {line_number}. Starting from the beginning.")
            except (ValueError, IOError) as e:
                print(f"Error reading progress file: {e}. Starting from the beginning.")
        else:
            print("No saved progress found. Starting from the beginning.")
    
    def save_progress(self):
        """Save current line to the progress file."""
        try:
            # Create directory if it doesn't exist
            self.progress_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.progress_file, 'w') as f:
                f.write(str(self.current_line))
        except IOError as e:
            print(f"Error saving progress: {e}")
    
    def get_next_chunk(self, chunk_size=120):
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
        
        # Save progress
        self.save_progress()
        
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

def generate_legends_and_prompts(chunk_data, client):
    """Generate quotes and image prompts from a chunk of the Mahabharata."""
    system_prompt = """You are a sophisticated AI specializing in ancient Sanskrit texts, particularly the Mahabharata.
    Your task is to extract 1-3 powerful quotes from the provided Mahabharata text chunk and transform them into "lore quotes" styled like Skyrim's loading screen tips.
    
    REQUIREMENTS:
    1. Analyze the text chunk and determine if it contains 1, 2, or 3 quote-worthy passages. Only extract multiple quotes if the passages are truly profound and distinct.
    2. Each quote MUST:
       - Be philosophical, timeless, and worthy of deep contemplation
       - Stand complete on its own without requiring additional context
       - Contain universal wisdom that transcends the specific narrative
       - Be limited to a MAXIMUM of 35 words (strictly enforce this)
       - Avoid mundane conversation or simple narrative statements
       - NOT be a character merely describing their momentary feelings or basic observations

    3. Format your response as an array of 1-3 quotes in JSON, with each quote containing:
       - The lore quote in English (short, impactful, philosophical)
       - The original Sanskrit (if present in the source text)
       - Reference information (approximate book/parva and chapter)
       - A brief explanation of the meaning
       - A lore-style snippet that expands on the quote's wisdom (like Skyrim's loading screens)
       - A single core concept/object that represents the quote's essence (for image generation)
    
    4. IMPORTANT: If a quote is someone's direct speech (e.g., "I believe...", "When I...", etc.), ALWAYS prefix it with the speaker's name followed by a colon. 
       For example: "Duryodhana: When I heard that Krishna and Arjuna had united..."
       This is crucial for proper context and interpretation.
    
    5. The core concept should be a singular object, person, or symbol that embodies the quote's central theme.
       Examples: "a warrior's bow", "scales of justice", "a lotus rising from mud", "two paths diverging"
       
    6. CRITICAL: If no profound philosophical quote is found, create one based on the themes present in the text or general Mahabharata themes like dharma, duty, or destiny.
    
    RESPONSE FORMAT:
    ```json
    [
      {
        "quote": "The concise English quote",
        "sanskrit": "Original Sanskrit if available",
        "reference": "Mahabharata, [Parva], Chapter [X]",
        "meaning": "Brief explanation of the quote's meaning",
        "lore_snippet": "A Skyrim-style loading screen tip based on this wisdom (2-3 sentences)",
        "core_concept": "One central object or symbol that represents this quote's essence"
      },
      {
        "quote": "Second quote if appropriate",
        "sanskrit": "Original Sanskrit if available",
        "reference": "Mahabharata, [Parva], Chapter [X]",
        "meaning": "Brief explanation of the second quote's meaning",
        "lore_snippet": "A Skyrim-style loading screen tip for second quote",
        "core_concept": "Core concept for second quote"
      },
      ...
    ]
    ```
    
    NOTE: Only include multiple quotes if the text chunk truly contains multiple profound, distinct philosophical insights. If only one good quote is found, return just one.
    """
    
    user_prompt = f"""Generate 1-3 lore quotes from this extract of the Mahabharata:
    
    ENGLISH TEXT:
    {chunk_data['english_text']}
    
    SANSKRIT TEXT (if available):
    {chunk_data['sanskrit_text']}
    
    Remember to identify powerful quotes or concepts, provide Sanskrit originals if available, reference information, meaning, lore-style snippets, and a single core concept that represents each quote's essence.
    
    If the text contains multiple profound insights, extract up to 3 quotes. Otherwise, just extract the single best quote.
    
    IMPORTANT: If you cannot find a direct quote in the text, create an appropriate quote that captures the essence or theme of the passage.
    """
    
    # Print information about the chunk being processed
    print(f"\nProcessing text chunk (lines {chunk_data['start_line']}-{chunk_data['end_line']}):")
    print(f"English text snippet: {chunk_data['english_text'][:150]}...")
    
    try:
        # Generate the lore quote using Together API
        print("Sending request to DeepSeek-V3 model...")
        response = client.chat.completions.create(
            model="deepseek-ai/DeepSeek-V3",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.7,
            max_tokens=1500
        )
        
        # Extract the JSON response
        response_text = response.choices[0].message.content
        print(f"\nModel response received - length: {len(response_text)} characters")
        
        # Extract JSON from the response
        json_match = re.search(r'```json\s*(.*?)\s*```', response_text, re.DOTALL)
        if json_match:
            json_str = json_match.group(1)
            print("Successfully extracted JSON from code block")
        else:
            # If not in code block, try to find valid JSON
            print("JSON code block not found, attempting to parse raw response")
            json_str = response_text
        
        try:
            # Parse the JSON
            quotes_data = json.loads(json_str)
            print(f"Successfully parsed JSON with {len(quotes_data)} quotes")
            
            # Process each quote in the response
            processed_quotes = []
            for quote_data in quotes_data:
                # Get the core concept
                core_concept = quote_data.get("core_concept", "a philosophical symbol")
                
                # Create a more detailed and artistic image prompt based on the core concept
                enhanced_concept = enhance_image_prompt(core_concept, quote_data.get("quote", ""), quote_data.get("meaning", ""))
                
                # Prepare the negative prompt
                negative_prompt = "photorealistic, 3D rendered, low quality, blurry, distorted, pixelated, anime, cartoonish, childish, sketch-like, messy, broken lines, poorly drawn faces, deformed limbs"
                
                # Add the enhanced elements to the quote data
                processed_quote = {
                    "quote": quote_data.get("quote", ""),
                    "sanskrit": quote_data.get("sanskrit", ""),
                    "reference": quote_data.get("reference", ""),
                    "meaning": quote_data.get("meaning", ""),
                    "lore_snippet": quote_data.get("lore_snippet", ""),
                    "image_prompt": enhanced_concept,
                    "negative_prompt": negative_prompt
                }
                
                processed_quotes.append(processed_quote)
                
            if not processed_quotes:
                raise ValueError("Parsed JSON but no quotes were found")
                
            return processed_quotes
        except json.JSONDecodeError as e:
            print(f"Error parsing JSON: {e}")
            print(f"JSON content: {json_str[:500]}...")
            raise
    except Exception as e:
        print(f"Error generating or parsing response: {e}")
        print(f"Raw response excerpt: {response_text[:500] if 'response_text' in locals() else 'No response'}")
        
        # Fallback: create a quote based on the chunk content
        print("Using fallback quote generation")
        # Extract a snippet from the English text to use as context
        context = chunk_data['english_text'][:150].strip()
        theme = "wisdom" if "wisdom" in context.lower() else "dharma" if "dharma" in context.lower() else "duty"
        
        return [{
            "quote": f"The path of {theme} is difficult, but its fruits are eternal.",
            "sanskrit": "धर्मस्य मार्गः कठिनः, फलं तु शाश्वतम्",
            "reference": f"Mahabharata, Inspired by lines {chunk_data['start_line']}-{chunk_data['end_line']}",
            "meaning": f"Though following the path of {theme} may present challenges, its rewards transcend temporal existence.",
            "lore_snippet": f"Ancient sages taught that while the path of {theme} is often arduous, those who walk it find lasting peace. Even in the face of adversity, the righteous are sustained by inner strength.",
            "image_prompt": f"a winding mountain path leading to a radiant summit, framed with bold decorative border of geometric patterns, ancient waymarkers along the route, traditional Indian symbolic motifs like peacocks, elephants, or lotus flowers, bold black outlines filled with vibrant flat colors, in Neo-Traditional Indian Art style, modern interpretation of Madhubani or Kalamkari art, bold black outlines with vibrant color fills, intricate pattern work, symbolic color usage, balanced composition with cultural motifs, flat perspective with symbolic representation, decorative borders and geometric framing elements",
            "negative_prompt": "photorealistic, 3D rendered, low quality, blurry, distorted, pixelated, anime, cartoonish, childish, sketch-like, messy, broken lines, poorly drawn faces, deformed limbs"
        }]

def enhance_image_prompt(core_concept, quote="", meaning=""):
    """Create a more detailed and realistic photographic style prompt from the core concept."""
    # Dictionary of realistic elements to add based on concept types
    realistic_elements = {
        "wheel": ["ancient wooden chariot wheel with intricate carvings", "ceremonial golden wheel with ornate detailing", "weathered stone wheel monument", "historical wooden wheel with metal reinforcements"],
        "flame": ["sacred fire altar with rising flames", "oil lamp with golden flame in darkness", "ritual fire ceremony with smoke", "ceremonial flame with sparks rising into night sky"],
        "bow": ["ornate warrior bow with decorative metal inlays", "ancient composite bow with taut bowstring", "ceremonial bow with symbolic markings", "weathered battle bow resting against sacred tree"],
        "sword": ["ancient royal sword with jeweled hilt", "battle-worn sword with ceremonial engravings", "ceremonial sword catching sunlight", "royal sword with gold inlay on display"],
        "tree": ["ancient banyan tree with sprawling roots at sunset", "sacred peepal tree with sunlight filtering through leaves", "majestic tree in meadow with golden hour lighting", "mystical forest clearing with morning mist"],
        "path": ["ancient stone pathway through dense forest", "mountain trail with dramatic lighting", "riverbank path with wildflowers at sunrise", "pilgrim route with distant temple structures"],
        "lotus": ["pink lotus flower floating on still water at dawn", "sacred lotus pond with golden light", "lotus blossom with water droplets", "lotus garden with perfect reflections at sunset"],
        "eye": ["expressive human eye with detailed iris in close-up", "contemplative gaze captured in portrait", "eye reflecting sacred symbols", "close-up of wise elder's penetrating gaze"],
        "hand": ["weathered hands in prayer position with traditional jewelry", "warrior's hand gripping weapon hilt", "hands offering sacred items", "detailed close-up of hands performing ritual gesture"],
        "scales": ["ornate golden scales of justice with intricate detailing", "ancient wooden balance scales with symbolic weights", "royal court judgment scales crafted from precious metals", "traditional measuring scales in historic setting"],
        "mountain": ["majestic Himalayan peaks at dawn", "holy mountain with pilgrimage path", "mountain vista with dramatic clouds and sunbeams", "snow-capped mountain reflecting in crystal lake"],
        "river": ["sacred river with golden light reflecting on rippling water", "serene river bend with ancient stone steps", "flowing river with morning mist", "river crossing with weathered stone structures"],
        "heart": ["anatomical heart with symbolic elements", "chest of warrior with hand over heart", "heart-shaped natural formation", "metaphorical representation of heart through natural elements"]
    }
    
    # Character dictionary with well-known features - only use when explicitly mentioned
    characters = {
        "krishna": ["dark-skinned divine figure with peacock feather crown", "serene face with compassionate expression", "playing divine flute", "royal yellow silk garments"],
        "arjuna": ["skilled archer with royal bearing", "noble warrior with determined expression", "wearing golden armor with royal insignia", "holding Gandiva bow"],
        "yudhishthira": ["wise king with calm demeanor", "royal figure with dignified pose", "eldest Pandava with thoughtful expression", "righteous leader with royal staff"],
        "bhima": ["powerfully built warrior", "strong figure wielding mace", "imposing physique with royal ornaments", "fierce expression with royal garments"],
        "draupadi": ["regal woman with long dark hair", "queen with dignified expression", "adorned with royal jewelry", "graceful figure in royal attire"],
        "karna": ["warrior with golden armor and earrings", "noble face with sun symbolism", "royal figure with tragic expression", "skilled archer with divine weapons"],
        "duryodhana": ["powerful royal figure", "proud warrior in ornate armor", "commanding presence with royal insignia", "determined expression with regal bearing"],
        "bhishma": ["elder sage with white beard", "wise patriarch with serene expression", "honorable warrior with dignified bearing", "revered figure with divine aura"],
        "dronacharya": ["venerable teacher with sacred thread", "wise guru with meditative expression", "master archer with calm demeanor", "respected elder in sage attire"],
        "kunti": ["noble mother with dignified bearing", "wise queen with compassionate expression", "maternal figure with royal attire", "serene woman with spiritual aura"]
    }
    
    # Photographic style elements for realistic imagery
    photography_styles = [
        "professional portrait photography with dramatic lighting",
        "cinematic composition with golden hour lighting",
        "high-resolution nature photography with rich details",
        "fine art photography with dramatic shadows",
        "documentary-style photography with authentic atmosphere",
        "award-winning National Geographic style photography",
        "professional landscape photography with perfect lighting",
        "artistic photography with shallow depth of field",
        "atmospheric photography with volumetric lighting",
        "high-quality photography with beautiful color grading",
        "historic photography with timeless quality",
        "portrait photography with strong emotional impact"
    ]
    
    # Settings from Mahabharata era
    settings = [
        "ancient Indian royal court with ornate pillars",
        "sacred forest clearing with filtered sunlight",
        "battlefield at dawn with mist rising from ground",
        "riverside hermitage with peaceful atmosphere",
        "mountain ashram with panoramic views",
        "palace gardens with exotic flowers",
        "village marketplace with traditional crafts",
        "temple courtyard with intricate stone carvings",
        "royal chariot path with ceremonial decorations",
        "meditation grove with ancient trees at sunrise"
    ]
    
    # Environmental elements to enhance atmosphere
    atmospheres = [
        "golden morning light creating long shadows",
        "dramatic clouds with rays of sunlight breaking through",
        "soft mist creating ethereal atmosphere",
        "warm sunset glow adding rich amber tones",
        "subtle smoke creating depth and atmosphere",
        "morning dew glistening on foliage",
        "dramatic shadows adding depth and contrast",
        "gentle rain creating reflections and mood",
        "stars visible in deep blue twilight sky",
        "moonlight creating silvery highlights"
    ]
    
    # Technical photography elements to enhance realism
    technical_elements = [
        "shot with high-end DSLR camera",
        "professional lighting with perfect exposure",
        "shot with medium format camera for incredible detail",
        "using natural lighting with reflectors",
        "captured with telephoto lens for compressed perspective",
        "high dynamic range capturing both shadows and highlights",
        "shot with wide aperture for beautiful bokeh",
        "using long exposure to capture movement",
        "precise focus highlighting important details",
        "high resolution with rich textures and details"
    ]
    
    # Extract key words from the core concept and quote
    concept_words = core_concept.lower().split()
    quote_words = quote.lower().split() if quote else []
    combined_words = concept_words + quote_words
    
    # Find matching realistic elements
    matching_elements = []
    for key, elements in realistic_elements.items():
        if any(key in word for word in combined_words):
            # If match found, add 1 random element from that category
            random_element = random.choice(elements)
            matching_elements.append(random_element)
    
    # If no specific matches, use a general element
    if not matching_elements:
        general_elements = [
            "ancient Indian scene with historical accuracy",
            "philosophical concept visualized in realistic setting",
            "sacred space with spiritual significance",
            "traditional scene with authentic cultural details"
        ]
        matching_elements = [random.choice(general_elements)]
    
    # Check for character mentions in the quote or concept
    mentioned_characters = []
    for character, features in characters.items():
        if any(character in word for word in combined_words):
            # If character is mentioned, add their description
            mentioned_characters.append(random.choice(features))
    
    # Select photography style, setting, atmosphere and technical element
    selected_style = random.choice(photography_styles)
    selected_setting = random.choice(settings)
    selected_atmosphere = random.choice(atmospheres)
    selected_technical = random.choice(technical_elements)
    
    # Build the prompt starting with the core concept
    prompt_elements = [core_concept]
    
    # Add character descriptions if any were mentioned, otherwise add a setting
    if mentioned_characters:
        prompt_elements.extend(mentioned_characters)
    else:
        prompt_elements.append(selected_setting)
    
    # Add matching elements and atmosphere
    prompt_elements.extend(matching_elements)
    prompt_elements.append(selected_atmosphere)
    
    # Add photography style and technical elements
    prompt_elements.append(selected_style)
    prompt_elements.append(selected_technical)
    
    # Join all elements with commas
    enhanced_prompt = ", ".join(prompt_elements)
    
    return enhanced_prompt

def generate_image_with_params(prompt, negative_prompt="", output_folder="assets/img/quotes", width=832, height=1248):
    """Generate an image using provided prompt and parameters."""
    # Generate unique filename
    current_time = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_filename = f"temp_image_{current_time}.png"
    temp_image_path = os.path.join(output_folder, unique_filename)
    
    # Ensure the output folder exists
    os.makedirs(output_folder, exist_ok=True)
    
    # Debug: Print complete prompt
    print(f"DEBUG: Image prompt: {prompt[:100]}...")
    
    # Prepare the workflow based on madhubani_workflow_api2.json
    workflow = {
        "3": {
            "inputs": {
                "seed": random.randint(1, 2**32 - 1),  # Random seed for variety
                "steps": 50,
                "cfg": 5,
                "sampler_name": "uni_pc",
                "scheduler": "simple",
                "denoise": 1,
                "model": [
                    "70",
                    0
                ],
                "positive": [
                    "16",
                    0
                ],
                "negative": [
                    "40",
                    0
                ],
                "latent_image": [
                    "53",
                    0
                ]
            },
            "class_type": "KSampler"
        },
        "8": {
            "inputs": {
                "samples": [
                    "3",
                    0
                ],
                "vae": [
                    "55",
                    0
                ]
            },
            "class_type": "VAEDecode"
        },
        "9": {
            "inputs": {
                "filename_prefix": "ComfyUI",
                "images": [
                    "8",
                    0
                ]
            },
            "class_type": "SaveImage"
        },
        "16": {
            "inputs": {
                "text": prompt,
                "clip": [
                    "54",
                    0
                ]
            },
            "class_type": "CLIPTextEncode"
        },
        "40": {
            "inputs": {
                "text": negative_prompt or "lowres, worst quality, jpeg artifacts, noisy, blurry, over‑sharpened, watermark, text, logo, oversaturated colors, chromatic aberration, distorted proportions, disfigured face or hands, extra limbs or fingers, cut‑off edges, grainy skin, banding, blown highlights, muddy shadows",
                "clip": [
                    "54",
                    0
                ]
            },
            "class_type": "CLIPTextEncode"
        },
        "53": {
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1
            },
            "class_type": "EmptySD3LatentImage"
        },
        "54": {
            "inputs": {
                "clip_name1": "clip_l_hidream.safetensors",
                "clip_name2": "clip_g_hidream.safetensors",
                "clip_name3": "t5xxl_fp8_e4m3fn_scaled.safetensors",
                "clip_name4": "llama_3.1_8b_instruct_fp8_scaled.safetensors"
            },
            "class_type": "QuadrupleCLIPLoader"
        },
        "55": {
            "inputs": {
                "vae_name": "ae.safetensors"
            },
            "class_type": "VAELoader"
        },
        "70": {
            "inputs": {
                "shift": 3.0,
                "model": [
                    "76",
                    0
                ]
            },
            "class_type": "ModelSamplingSD3"
        },
        "76": {
            "inputs": {
                "unet_name": "hidream_i1_full_fp8.safetensors",
                "weight_dtype": "default"
            },
            "class_type": "UNETLoader"
        }
    }
    
    # Submit the workflow to the ComfyUI API
    try:
        prompt_id = str(uuid.uuid4())
        
        # Prepare the API request
        p = {"prompt": workflow, "client_id": client_id}
        data = json.dumps(p).encode('utf-8')
        
        # Get the ComfyUI server address from environment or use default
        comfy_api_url = os.environ.get("COMFY_API_URL", "http://127.0.0.1:8188")
        
        # Check if we have an API key in environment
        api_key = os.environ.get("COMFY_API_KEY", "")
        
        # Submit the prompt
        print(f"Submitting workflow to ComfyUI ({comfy_api_url})...")
        print(f"DEBUG: Using API key: {'Yes' if api_key else 'No'}")
        
        # Use requests instead of urllib for consistency with audio generation
        headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        # Add API key to headers if available
        if api_key:
            headers['Authorization'] = f'Bearer {api_key}'
        
        # Debug the request
        print(f"DEBUG: Request headers: {headers}")
        print(f"DEBUG: Request URL: {comfy_api_url}/api/prompt")
        
        response = requests.post(
            f"{comfy_api_url}/api/prompt",
            data=data,
            headers=headers
        )
        
        if response.status_code != 200:
            print(f"Error submitting workflow: HTTP Error {response.status_code}: {response.reason}")
            print(f"Response content: {response.text[:500]}")
            return None
            
        res = response.json()
        prompt_id = res.get('prompt_id', prompt_id)
        print(f"Workflow submitted with prompt ID: {prompt_id}")
        
        # Now wait for the prompt to finish execution
        waiting_for_output = True
        output_images = []
        
        print("Waiting for image generation to complete...")
        while waiting_for_output:
            # Check if prompt is still in queue
            queue_response = requests.get(f"{comfy_api_url}/api/queue")
            if queue_response.status_code != 200:
                print(f"Error checking queue: {queue_response.status_code}")
                return None
                
            queue_status = queue_response.json()
            is_in_queue = False
            for item in queue_status.get('queue_running', []):
                if item[1] == prompt_id:
                    is_in_queue = True
                    print("  - Still running...")
                    break
            
            for item in queue_status.get('queue_pending', []):
                if item[1] == prompt_id:
                    is_in_queue = True
                    print("  - Pending in queue...")
                    break
            
            if not is_in_queue and len(queue_status.get('queue_pending', [])) == 0:
                waiting_for_output = False
        
            # If not in queue, check for outputs
            if not waiting_for_output:
                history_response = requests.get(f"{comfy_api_url}/api/history")
                if history_response.status_code != 200:
                    print(f"Error getting history: {history_response.status_code}")
                    return None
                    
                history = history_response.json()
                if prompt_id in history:
                    for node_id, node_output in history[prompt_id].get('outputs', {}).items():
                        if 'images' in node_output:
                            for image_info in node_output['images']:
                                output_images.append(image_info['filename'])
        
            # Wait a bit before checking again to reduce API load
            time.sleep(2)
        
        # Download the image
        if output_images:
            print(f"Image generation complete. Found output image: {output_images[0]}")
            try:
                # Try different possible image URL patterns
                possible_urls = [
                    f"{comfy_api_url}/api/view?filename={output_images[0]}&subfolder=&type=output",
                    f"{comfy_api_url}/api/view?filename={output_images[0]}",
                    f"{comfy_api_url}/api/output/{output_images[0]}",
                    f"{comfy_api_url}/api/file/output/{output_images[0]}"
                ]
                
                success = False
                for i, url in enumerate(possible_urls):
                    try:
                        print(f"Attempting to download image using URL pattern {i+1}/{len(possible_urls)}")
                        img_response = requests.get(url, stream=True)
                        if img_response.status_code == 200:
                            with open(temp_image_path, 'wb') as f:
                                for chunk in img_response.iter_content(chunk_size=8192):
                                    f.write(chunk)
                            
                            if os.path.exists(temp_image_path) and os.path.getsize(temp_image_path) > 0:
                                print(f"✓ Successfully downloaded image using pattern {i+1}")
                                success = True
                                break
                        else:
                            print(f"  - Failed with pattern {i+1}: HTTP {img_response.status_code}")
                    except Exception as e:
                        print(f"  - Failed with pattern {i+1}: {e}")
                
                if not success:
                    print("Failed to download image with all patterns")
                    return None
            except Exception as e:
                print(f"Error downloading image: {e}")
                return None
        else:
            print("No images were found in the output")
            return None
    except Exception as e:
        print(f"Error submitting workflow: {e}")
        return None
    
    # Check if the image was successfully downloaded and exists
    if os.path.exists(temp_image_path) and os.path.getsize(temp_image_path) > 0:
        print(f"Image successfully saved to {temp_image_path}")
        return temp_image_path
    else:
        print("Image download completed but file not found or empty")
        return None

def generate_and_save_image(quote_data, quote_number, existing_facts, previous_image_url=None):
    """Generate and save an image for a quote using Together API."""
    # Extract the prompt from the quote data
    prompt = quote_data.get("image_prompt", "")
    negative_prompt = quote_data.get("negative_prompt", "")
    
    if not prompt:
        print(f"No image prompt found for quote {quote_number}. Skipping image generation.")
        return None
    
    print(f"\nGenerating image {quote_number} with prompt: {prompt}")
    print(f"Negative prompt: {negative_prompt}")
    
    # Create the final image path
    os.makedirs("assets/img/quotes", exist_ok=True)
    final_image_path = Path(f"assets/img/quotes/quote_{quote_number}.png")
    
    # Generate the image
    temp_image_path = generate_image_with_params(
        prompt=prompt,
        negative_prompt=negative_prompt
    )
    
    # If image generation was successful, rename to final path
    if temp_image_path:
        try:
            # Rename temp file to final path
            os.rename(temp_image_path, final_image_path)
            print(f"✓ Successfully generated image for quote {quote_number} at {final_image_path}")
            return final_image_path
        except Exception as e:
            print(f"Error renaming image: {e}")
            return None
    
    print(f"× Failed to generate image for quote {quote_number}")
    return None

def generate_audio_prompt(quote_data):
    """Generate an appropriate audio prompt based on the quote content."""
    quote = quote_data.get("quote", "")
    meaning = quote_data.get("meaning", "")
    core_concept = quote_data.get("core_concept", "")
    
    # Base themes for the audio
    themes = [
        "smooth jazz instrumental with subtle piano accents",
        "upbeat electronic house music with relaxing synth melodies",
        "classical crossover with modern string arrangements",
        "cinematic orchestral theme with emotive string sections",
        "chill electronic with atmospheric pads and textures"
    ]
    
    # Select a base theme
    base_theme = random.choice(themes)
    
    # Keywords to detect in quotes and their corresponding musical elements
    keywords = {
        "battle": "heroic percussion and dramatic string crescendos",
        "dharma": "righteous, noble melody with deep resonance",
        "wisdom": "contemplative flute passages with gentle rhythms",
        "death": "somber, reflective motifs with sparse instrumentation",
        "god": "divine, ethereal soundscape with bells and chimes",
        "warrior": "powerful rhythmic patterns with bold brass accents",
        "peace": "serene, flowing melodies with ambient textures",
        "karma": "cyclical patterns with layered instrumental textures",
        "time": "ticking rhythms and flowing temporal progressions",
        "destiny": "fateful harmonic progressions with tense resolution",
        "victory": "triumphant melodic theme with uplifting dynamics",
        "sacrifice": "mournful yet dignified melodic progression",
        "journey": "progressive musical narrative with evolving motifs",
        "love": "tender melodic passages with emotional strings"
    }
    
    # Analyze quote for keywords and add musical elements
    additional_elements = []
    for keyword, element in keywords.items():
        if keyword.lower() in quote.lower() or keyword.lower() in meaning.lower() or keyword.lower() in core_concept.lower():
            additional_elements.append(element)
    
    # Build the final prompt
    prompt = base_theme
    
    # Add up to 2 additional elements from the detected keywords
    if additional_elements:
        elements_to_add = additional_elements[:2]  # Limit to 2 elements to avoid overly complex prompts
        elements_text = " with " + " and ".join(elements_to_add)
        prompt += elements_text
    
    return prompt

def generate_audio_with_params(prompt, audio_length=45, quote_number=1):
    """Generate an audio file using the ComfyUI stable audio workflow."""
    try:
        # Create the audio directory if it doesn't exist
        os.makedirs("assets/audio/quotes", exist_ok=True)
        
        # Define output audio path
        audio_path = f"assets/audio/quotes/quote_{quote_number}.mp3"
        
        # Create the Stable Audio workflow
        workflow = {
            "3": {
                "inputs": {
                    "seed": random.randint(1, 2**32 - 1),
                    "steps": 50,
                    "cfg": 6,
                    "sampler_name": "dpmpp_3m_sde_gpu",
                    "scheduler": "exponential",
                    "denoise": 1,
                    "model": [
                        "25",
                        0
                    ],
                    "positive": [
                        "6",
                        0
                    ],
                    "negative": [
                        "7",
                        0
                    ],
                    "latent_image": [
                        "11",
                        0
                    ]
                },
                "class_type": "KSampler",
                "_meta": {
                    "title": "KSampler"
                }
            },
            "6": {
                "inputs": {
                    "text": prompt,
                    "clip": [
                        "10",
                        0
                    ]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {
                    "title": "CLIP Text Encode (Prompt)"
                }
            },
            "7": {
                "inputs": {
                    "text": "",
                    "clip": [
                        "10",
                        0
                    ]
                },
                "class_type": "CLIPTextEncode",
                "_meta": {
                    "title": "CLIP Text Encode (Prompt)"
                }
            },
            "10": {
                "inputs": {
                    "clip_name": "t5_base.safetensors",
                    "type": "stable_audio",
                    "device": "default"
                },
                "class_type": "CLIPLoader",
                "_meta": {
                    "title": "Load CLIP"
                }
            },
            "11": {
                "inputs": {
                    "seconds": audio_length,
                    "batch_size": 1
                },
                "class_type": "EmptyLatentAudio",
                "_meta": {
                    "title": "EmptyLatentAudio"
                }
            },
            "12": {
                "inputs": {
                    "samples": [
                        "3",
                        0
                    ],
                    "vae": [
                        "25",
                        2
                    ]
                },
                "class_type": "VAEDecodeAudio",
                "_meta": {
                    "title": "VAEDecodeAudio"
                }
            },
            "13": {
                "inputs": {
                    "filename_prefix": f"audio/quotes/quote_{quote_number}",
                    "audio": [
                        "12",
                        0
                    ]
                },
                "class_type": "SaveAudio",
                "_meta": {
                    "title": "SaveAudio"
                }
            },
            "25": {
                "inputs": {
                    "ckpt_name": "Instrumental-FT.ckpt"
                },
                "class_type": "CheckpointLoaderSimple",
                "_meta": {
                    "title": "Load Checkpoint"
                }
            }
        }
        
        print(f"\nGenerating audio for quote {quote_number} with prompt: {prompt}")
        
        # Queue the audio generation
        prompt_data = {
            "prompt": workflow,
            "client_id": client_id
        }
        
        response = requests.post(
            f"{COMFY_API_URL}/api/prompt",
            json=prompt_data,
            headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        )
        
        if response.status_code != 200:
            print(f"Error submitting audio workflow: {response.status_code}")
            print(f"Response: {response.text}")
            return None
        
        prompt_id = response.json().get("prompt_id")
        print(f"Audio workflow submitted successfully with ID: {prompt_id}")
        
        # Monitor execution
        start_time = time.time()
        timeout = 900  # 15 minutes timeout (audio generation can take longer)
        
        print("Waiting for audio generation to complete...")
        while time.time() - start_time < timeout:
            try:
                # Check queue status
                queue_response = requests.get(f"{COMFY_API_URL}/api/queue")
                queue_data = queue_response.json()
                
                # Check if our prompt is still in the queue
                is_in_queue = False
                for item in queue_data.get("queue_running", []):
                    if item[1] == prompt_id:
                        is_in_queue = True
                        print("  - Still running...")
                        break
                
                for item in queue_data.get("queue_pending", []):
                    if item[1] == prompt_id:
                        is_in_queue = True
                        print("  - Pending in queue...")
                        break
                
                if not is_in_queue:
                    # Check if execution is done by getting history
                    history_response = requests.get(f"{COMFY_API_URL}/api/history/{prompt_id}")
                    if history_response.status_code == 200:
                        print("✓ Audio generation completed!")
                        
                        # Get output from SaveAudio node
                        history_data = history_response.json()
                        node_outputs = history_data.get(prompt_id, {}).get("outputs", {})
                        
                        audio_filename = None
                        audio_subfolder = ""
                        
                        # Look for the output from the SaveAudio node
                        for node_id, node_output in node_outputs.items():
                            if "audio" in node_output:
                                for audio_info in node_output["audio"]:
                                    audio_filename = audio_info.get("filename")
                                    audio_subfolder = audio_info.get("subfolder", "")
                                    break
                                if audio_filename:
                                    break
                        
                        if audio_filename:
                            # Download the audio file
                            audio_url = f"{COMFY_API_URL}/api/view"
                            params = {
                                "filename": audio_filename,
                                "subfolder": audio_subfolder,
                                "type": "output"
                            }
                            
                            audio_response = requests.get(audio_url, params=params, stream=True)
                            if audio_response.status_code == 200:
                                # Save the audio file
                                with open(audio_path, 'wb') as f:
                                    for chunk in audio_response.iter_content(chunk_size=8192):
                                        f.write(chunk)
                                
                                print(f"✓ Audio saved to {audio_path}")
                                return audio_path
                            else:
                                print(f"Error downloading audio: {audio_response.status_code}")
                        else:
                            print("No audio found in output")
                        
                        break
                
                # Wait before checking again
                time.sleep(10)  # Longer interval for audio generation
                
            except Exception as e:
                print(f"Error checking audio status: {e}")
                time.sleep(10)
        
        if time.time() - start_time >= timeout:
            print("Timed out waiting for audio generation")
        
        return None
    
    except Exception as e:
        print(f"Error generating audio: {e}")
        return None

def generate_and_save_audio(quote_data, quote_number):
    """Generate and save an audio file for a quote."""
    # Generate an appropriate audio prompt based on the quote content
    audio_prompt = generate_audio_prompt(quote_data)
    
    # Check if audio already exists
    audio_path = Path(f"assets/audio/quotes/quote_{quote_number}.mp3")
    if audio_path.exists():
        print(f"Audio file for quote {quote_number} already exists at {audio_path}")
        return audio_path
    
    # Generate the audio
    result_path = generate_audio_with_params(
        prompt=audio_prompt,
        audio_length=45,  # 45 seconds is a good length for background music
        quote_number=quote_number
    )
    
    if result_path:
        print(f"✓ Successfully generated audio for quote {quote_number} at {result_path}")
        return Path(result_path)
    else:
        print(f"× Failed to generate audio for quote {quote_number}")
        return None

def process_mahabharata_chunk(chunk_data, client, existing_facts, start_from_number, previous_image_url=None):
    """Process a chunk of the Mahabharata text to generate facts and images."""
    # Generate quotes and image prompts
    print("\nAttempting to generate lore quotes from current chunk...")
    quotes_data = generate_legends_and_prompts(chunk_data, client)
    
    # Initialize result stats
    new_facts = []
    new_quote_numbers = []
    
    # Check if we actually got valid quotes back (might be empty in some text chunks)
    if not quotes_data or len(quotes_data) == 0:
        print("No quotes found in this text chunk. Skipping...")
        return {
            "new_facts": [],
            "quote_numbers": []
        }
    
    print(f"\nProcessing {len(quotes_data)} lore quote(s)...")
    
    # Process each quote
    for i, quote_data in enumerate(quotes_data):
        # Determine the quote number
        quote_number = start_from_number + i
        
        print(f"\nProcessing quote #{quote_number}:")
        print(f"Quote: {quote_data.get('quote', 'N/A')}")
        print(f"Core concept: {quote_data.get('core_concept', 'N/A') if 'core_concept' in quote_data else 'N/A'}")
        
        # Generate and save the image
        image_path = generate_and_save_image(quote_data, quote_number, existing_facts)
        
        # Generate and save the audio
        audio_path = generate_and_save_audio(quote_data, quote_number)
        
        # Save the quote to the directory
        quote_entry = save_quote_to_directory(quote_data, quote_number, image_path, audio_path)
        
        # Add to new facts list
        new_facts.append(quote_entry)
        new_quote_numbers.append(quote_number)
    
    print(f"\n✓ Generated {len(new_facts)} new lore quote(s)")
    
    return {
        "new_facts": new_facts,
        "quote_numbers": new_quote_numbers
    }

def save_quote_to_directory(quote_data, quote_number, image_path=None, audio_path=None):
    """Save a quote to the directory.json file."""
    # Format the quote data
    quote_entry = {
        "id": f"quote_{quote_number}",
        "quote": quote_data.get("quote", ""),
        "sanskrit": quote_data.get("sanskrit", ""),
        "reference": quote_data.get("reference", ""),
        "meaning": quote_data.get("meaning", ""),
        "lore_snippet": quote_data.get("lore_snippet", ""),
        "image": image_path.name if image_path else None,
        "audio": f"quote_{quote_number}.mp3" if audio_path else None,
        "category": "philosophy",
        "tags": ["mahabharata", "wisdom", "ancient", "dharma"]
    }
    
    return quote_entry

def generate_pwa_icons():
    """Generate various sized icons needed for PWA from the favicon."""
    print("\nGenerating PWA icons...")
    
    # Ensure the img directory exists
    os.makedirs("assets/img", exist_ok=True)
    
    # Source favicon path
    favicon_path = "assets/img/favicon-96x96.png"
    
    # Check if favicon exists
    if not os.path.exists(favicon_path):
        print(f"Error: Favicon not found at {favicon_path}")
        return False
    
    try:
        # Open the source favicon
        favicon = Image.open(favicon_path)
        
        # Define sizes for different icons
        icon_sizes = {
            "icon-192x192.png": (192, 192),
            "icon-512x512.png": (512, 512),
            "icon-maskable-192x192.png": (192, 192),
            "icon-maskable-512x512.png": (512, 512),
        }
        
        # Create icons in different sizes
        for filename, size in icon_sizes.items():
            output_path = f"assets/img/{filename}"
            
            # Skip if file already exists
            if os.path.exists(output_path):
                print(f"PWA icon already exists: {output_path}")
                continue
            
            # Create a copy of the favicon
            icon = favicon.copy()
            
            # Resize the icon
            icon = icon.resize(size, Image.LANCZOS)
            
            # For maskable icons, add padding (20% of size)
            if "maskable" in filename:
                # Create a new image with padding
                padding = int(size[0] * 0.2)
                padded_size = (size[0] + 2 * padding, size[1] + 2 * padding)
                padded_image = Image.new("RGBA", padded_size, (0, 0, 0, 0))
                
                # Paste the original icon in the center
                padded_image.paste(icon, (padding, padding))
                
                # Update the icon
                icon = padded_image.resize(size, Image.LANCZOS)
            
            # Save the icon
            icon.save(output_path)
            print(f"Generated PWA icon: {output_path}")
        
        print("✓ PWA icons generated successfully")
        return True
    
    except Exception as e:
        print(f"Error generating PWA icons: {e}")
        return False

def main():
    """Main function to generate Mahabharata lore quotes."""
    print("\n=== Mahabharata Lore Quotes Generator ===")
    
    # Create necessary directories
    os.makedirs("assets/img/quotes", exist_ok=True)
    os.makedirs("assets/data", exist_ok=True)
    os.makedirs("assets/audio/quotes", exist_ok=True)
    
    # Generate PWA icons if needed
    generate_pwa_icons()
    
    # Load existing facts
    existing_facts = load_existing_facts()
    highest_quote_number = get_highest_quote_number(existing_facts)
    
    print(f"Found {len(existing_facts['quotes'])} existing lore quotes")
    print(f"Highest quote number: {highest_quote_number}")
    
    # Initialize the Mahabharata reader
    reader = MahabharataReader()
    
    # Check if we should run once or continuously
    run_continuously = "--continuous" in sys.argv
    auto_commit = "--commit" in sys.argv
    
    # Get batch size
    batch_size = 1
    try:
        for i, arg in enumerate(sys.argv[1:]):
            if arg.isdigit():
                batch_size = int(arg)
                break
    except ValueError:
        print("Invalid batch size argument. Using default (1 quote per batch).")
    
    # Run continuously until interrupted or once if not specified
    try:
        batch_count = 0
        consecutive_empty_batches = 0
        max_empty_batches = 3  # After this many empty batches, we'll force quote generation
        
        while True:
            batch_count += 1
            print(f"\n--- Batch #{batch_count} ---")
            print(f"\nGenerating {batch_size} new lore quotes...")
            
            # Load the latest facts for each batch
            if batch_count > 1:
                existing_facts = load_existing_facts()
                highest_quote_number = get_highest_quote_number(existing_facts)
                print(f"Updated quote count: {len(existing_facts['quotes'])}")
                print(f"Updated highest quote number: {highest_quote_number}")
            
            # Process chunks of text
            new_facts = []
            for i in range(batch_size):
                print(f"\n--- Processing Item {i+1}/{batch_size} ---")
                
                # Try up to more chunks if we're in continuous mode to find a good quote
                max_chunks_to_try = 5 if run_continuously else 1  # Increased from 3 to 5
                chunk_attempts = 0
                result = None
                
                # If we've had too many empty batches, force a quote by setting force_fallback
                force_fallback = consecutive_empty_batches >= max_empty_batches
                if force_fallback:
                    print(f"\nNOTE: After {consecutive_empty_batches} empty batches, forcing quote generation")
                
                while chunk_attempts < max_chunks_to_try and (result is None or len(result["new_facts"]) == 0):
                    # Get the next chunk of text
                    chunk_data = reader.get_next_chunk(chunk_size=120)
                    chunk_attempts += 1
                    
                    if chunk_attempts > 1:
                        print(f"\nNo quotes found in previous chunk. Trying chunk #{chunk_attempts}...")
                    
                    # Process the chunk
                    result = process_mahabharata_chunk(
                        chunk_data, 
                        client, 
                        existing_facts, 
                        highest_quote_number + 1 + len(new_facts)
                    )
                
                if result and len(result["new_facts"]) > 0:
                    # Add new facts to the list
                    new_facts.extend(result["new_facts"])
                    consecutive_empty_batches = 0  # Reset the counter
                else:
                    print(f"\nCouldn't find any good quotes after trying {chunk_attempts} chunks.")
            
            # If we couldn't generate any quotes this batch
            if len(new_facts) == 0:
                consecutive_empty_batches += 1
                print(f"No quotes generated in this batch. Empty batch count: {consecutive_empty_batches}/{max_empty_batches}")
            else:
                # Add new facts to existing facts
                existing_facts["quotes"].extend(new_facts)
                
                # Save the updated facts
                save_facts(existing_facts)
                
                print(f"\n✓ Successfully generated {len(new_facts)} new lore quotes!")
                print(f"Total lore quotes in directory: {len(existing_facts['quotes'])}")
                
                # Commit and push changes if requested
                if auto_commit and len(new_facts) > 0:
                    git_commit_and_push(len(new_facts))
            
            # Exit if not running continuously
            if not run_continuously:
                print("\nDone!")
                break
                
            # If running continuously, wait before the next batch
            # Reduce wait time if we had empty batches
            pause_duration = 300 if consecutive_empty_batches == 0 else max(60, 300 - (consecutive_empty_batches * 60))
            print(f"\nWaiting {pause_duration} seconds before next batch...")
            print("(Press Ctrl+C to exit)")
            
            # Show a countdown timer
            for remaining in range(pause_duration, 0, -1):
                mins = remaining // 60
                secs = remaining % 60
                print(f"\rNext batch in: {mins:02d}:{secs:02d}", end="")
                time.sleep(1)
            
            print("\rStarting next batch...                  ")
            
    except KeyboardInterrupt:
        print("\nCtrl+C detected! Exiting...")
        sys.exit(0)

if __name__ == "__main__":
    main() 