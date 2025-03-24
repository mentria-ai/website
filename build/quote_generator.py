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
    print(f"Saved {len(facts_data['quotes'])} fascinating facts to {json_path}")

def git_commit_and_push(num_new_facts):
    """Commit the latest changes and push to the repository."""
    try:
        print("\nCommitting and pushing changes to the repository...")
        
        # Stage the changes
        subprocess.run(["git", "add", "assets/data/directory.json", "assets/img/quotes/"], check=True)
        
        # Create a descriptive commit message
        commit_message = f"Add {num_new_facts} new fascinating facts with Ghibli art"
        subprocess.run(["git", "commit", "-m", commit_message], check=True)
        
        # Push to the repository (assuming 'main' branch)
        subprocess.run(["git", "push", "origin", "main"], check=True)
        
        print("✓ Successfully committed and pushed new facts to the repository!")
    except subprocess.CalledProcessError as e:
        print(f"Error during Git operations: {e}")
    except Exception as e:
        print(f"Unexpected error during Git operations: {e}")

def get_random_mahabharata_snippet(line_count=500):
    """Read a random snippet from the translated Mahabharata text file."""
    print("Reading random snippet from translated Mahabharata text...")
    
    mahabharata_path = Path("assets/data/reference/mahabharat_translated.txt")
    
    if not mahabharata_path.exists():
        print(f"Error: Translated Mahabharata text file not found at {mahabharata_path}")
        return "Error: Translated Mahabharata text file not found."
    
    # Get file size and line count
    file_size = mahabharata_path.stat().st_size
    
    # Read all lines from the file
    with open(mahabharata_path, 'r', encoding='utf-8', errors='ignore') as file:
        all_lines = file.readlines()
    
    total_lines = len(all_lines)
    print(f"Total lines in file: {total_lines}")
    
    # Choose a random starting line
    max_start_line = max(0, total_lines - line_count - 100)  # Add buffer to ensure we can get enough lines
    start_line = random.randint(0, max_start_line)
    
    # Collect lines while skipping blank lines
    collected_lines = []
    current_line = start_line
    
    while len(collected_lines) < line_count and current_line < total_lines:
        line = all_lines[current_line].strip()
        # Skip only completely empty lines
        if line and "[Blank line]" not in line:
            collected_lines.append(line)
        current_line += 1
    
    # Process the collected lines - just remove pipe characters at start and end
    processed_lines = []
    
    for line in collected_lines:
        # Remove pipe at start and end if present, preserve all content
        if line.startswith('|'):
            line = line[1:]
        if line.endswith('|'):
            line = line[:-1]
        processed_lines.append(line)
    
    # Combine all lines into a single text
    snippet = ' '.join(processed_lines)
    
    # Count words for logging
    word_count = len(snippet.split())
    
    print(f"Read {len(collected_lines)} lines with {word_count} words total.")
    return snippet

def generate_facts_from_mahabharata(mahabharata_snippet, num_facts=4):
    """Generate facts based on a snippet from the Mahabharata text."""
    
    # Create the system prompt
    system_prompt = """You are an expert at creating direct, concise facts based on ancient texts, paired with minimalist Ghibli Art style image prompts.

Extract unique, fascinating facts directly from the provided ancient text snippet from the translated Mahabharata. These facts should be direct, educational, and presented without unnecessary interpretation. Each fact should be accompanied by a minimalist artistic image prompt that illustrates it through a Ghibli-styled lens.

EXTREMELY IMPORTANT: Each fact must focus on a completely different aspect of the text. No two facts should cover similar themes, characters, or concepts. Ensure maximum diversity between facts. For example, if one fact covers a battle tactic, another might focus on philosophical teachings, a third on cultural practices, and a fourth on interpersonal relationships. Ensure maximum diversity between facts across all dimensions - topics, characters, locations, objects, and concepts.

Each fact should be concise (15-40 words MAX) and directly extracted from the text without adding your own interpretation or obvious conclusions. Present the fact as it is, without statements like "showcasing the deep bond" or "highlighting the importance" - let the readers draw their own conclusions.

You may explicitly mention the Mahabharata when it's necessary to make the fact complete and meaningful. However, do not overuse the reference - only include it when it adds significant value to the fact.

Each image prompt should start with "Ghibli Art:" and should embody the simplistic, meaningful beauty characteristic of Studio Ghibli.
IMPORTANT REQUIREMENTS FOR EVERY IMAGE PROMPT:
1. Create a MINIMALIST scene with as few elements as possible - focus on one or two main subjects only
2. Embrace simplicity and empty space - avoid cluttering the image with too many details
3. Use soft color palettes and gentle atmospherics (like mist or subtle lighting) to create mood rather than adding more objects
4. If including a character, make them the clear focus of the composition
5. Aim for a serene, contemplative quality that conveys meaning through simplicity rather than complexity

For each fact, identify important words that should be emphasized in the animation. There are only two levels of emphasis:
- emphasis-1: Used for the single most important word that captures the essence of the fact (use in only 30% of facts). This will be highlighted in gold color.
- emphasis-2: Used only for key terms or transitional words that improve readability. This will be underlined.

IMPORTANT: Never refer to elements from the Mahabharata as "myths" or "mythical." Treat them as historical and cultural elements with reverence."""
    
    # Create the user prompt
    user_prompt = f"""Based on the following translated text snippet from the Mahabharata, please generate {num_facts} unique and fascinating facts.

TRANSLATED MAHABHARATA SNIPPET:
```
{mahabharata_snippet}
```

For each fact, create:
1. A brief, direct fact (15-40 words MAX) that is extracted directly from the text without your own interpretation
2. A SIMPLE image prompt with Ghibli Art style that has as few elements as possible while maintaining meaningful beauty
3. An emphasis object that marks important words for animation
4. A context field (120-150 words) that provides the exact source from the text

IMPORTANT REQUIREMENTS:
- Extract facts directly from the text WITHOUT adding your interpretation or obvious conclusions
- Do NOT include phrases like "showcasing," "highlighting," or "illustrating" - just state the fact directly
- You may mention the Mahabharata when necessary to make the fact complete and meaningful, but don't overuse it
- Present these as interesting facts about history, culture, and tradition from this ancient epic
- Never describe elements from the Mahabharata as "myths" or "mythical" - treat them with reverence as historical and cultural elements
- Make the facts interesting yet grounded in the actual translated text provided

EXTREMELY IMPORTANT FOR DIVERSITY:
- CRITICAL: The {num_facts} facts MUST be about completely different deities, characters, and concepts:
  * If one fact mentions Agni, NO OTHER fact should mention Agni
  * Each fact must focus on a different deity, character, concept, or aspect of life
  * Ensure ZERO thematic overlap between any two facts
  * Facts should cover entirely different areas like: specific deities, cultural practices, locations, objects, relationships, etc.

THE IMAGE PROMPT MUST BE SIMPLE AND MINIMALIST:
- Focus on just 1-2 main elements/subjects
- Embrace empty space and simplicity
- Use atmospheric elements (like light, mist) to create mood rather than adding more objects
- Aim for serene, contemplative beauty with minimal details
- Avoid overly complex or crowded scenes

The context field MUST:
  * Include the exact phrases or quotations from the text that contain the fact
  * Provide only the necessary context to understand where the fact comes from
  * Avoid adding your own interpretation of the significance of the fact
  * Simply explain which part of the text contains this information

Format your response as a valid JSON array with objects containing:
1. "quote": The fact (keep this field name as "quote" for compatibility)
2. "image_prompt": A simple, minimalist Ghibli Art style image prompt following the requirements
3. "emphasis": An object mapping words to their emphasis level - use emphasis-1 for color highlighting of the most important term, and emphasis-2 for underlining key terms
4. "context": Reference to the exact source in the text (120-150 words) without adding interpretation

Example:
{{
    "quote": "In the Mahabharata, warriors would perform sacred rites before entering the battlefield, offering prayers to the deities of war.",
    "image_prompt": "Ghibli Art: A lone warrior kneels in silent prayer under a massive tree. Soft morning light filters through branches.",
    "emphasis": {{
        "sacred rites": "emphasis-2",
        "deities of war": "emphasis-1"
    }},
    "context": "The text states that warriors 'would perform sacred rites before entering the battlefield' and specifically mentions them 'offering prayers to the deities of war.' It also describes how they would 'purify their weapons with sacred water and mantras.' These descriptions are found in the section where the preparation for battle is being discussed, providing specific details about the pre-battle rituals that were considered important for warriors."
}}

Respond with only the JSON array, no additional text."""

    # Generate facts based on the Mahabharata snippet
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    print(f"Generating {num_facts} fascinating facts based on Mahabharata snippet...")
    
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
            new_facts = json.loads(json_str)
        else:
            # Fallback if JSON array not found
            print("JSON array not found in response. Attempting to parse entire response...")
            new_facts = json.loads(response_text)
            
        return new_facts
    except json.JSONDecodeError as e:
        print(f"Error parsing JSON: {e}")
        print(f"Response text: {response_text}")
        return []

def generate_and_save_image(prompt, image_path):
    """Generate an image using the provided prompt and save it to the specified path."""
    try:
        print(f"Generating image for: {prompt[:50]}...")
        
        # Using the working API format for FLUX with LoRAs
        response = client.images.generate(
            model="black-forest-labs/FLUX.1-dev-lora", 
            prompt=prompt,
            width=832,
            height=1440,
            steps=30,
            n=1,
            response_format="url",
            image_loras=[
                {"path": "https://huggingface.co/strangerzonehf/Flux-Ghibli-Art-LoRA/resolve/main/Ghibli-Art.safetensors", "scale": 1}
            ]
        )
        
        # Download and save the image from URL
        import requests
        img_response = requests.get(response.data[0].url)
        if img_response.status_code == 200:
            with open(image_path, 'wb') as f:
                f.write(img_response.content)
            print(f"Image saved to {image_path}")
        else:
            raise Exception(f"Failed to download image, status code: {img_response.status_code}")
        
        return True
    
    except Exception as e:
        print(f"Error generating image: {e}")
        
        # Try an alternative approach if the first method fails
        try:
            print("Attempting alternative approach...")
            response = client.images.generate(
                model="black-forest-labs/FLUX.1-dev-lora", 
                prompt=prompt,
                width=832,
                height=1440,
                steps=30,
                n=1,
                image_loras=[
                    {"path": "https://huggingface.co/strangerzonehf/Flux-Ghibli-Art-LoRA/resolve/main/Ghibli-Art.safetensors", "scale": 1}
                ]
            )
            
            import requests
            img_response = requests.get(response.data[0].url)
            if img_response.status_code == 200:
                with open(image_path, 'wb') as f:
                    f.write(img_response.content)
                print(f"Image saved to {image_path}")
                return True
        
        except Exception as e2:
            print(f"Alternative approach also failed: {e2}")
        
        return False

def main():
    # Create necessary directories
    os.makedirs("assets/img/quotes", exist_ok=True)
    os.makedirs("assets/data", exist_ok=True)
    
    print("===== Mahabharata Fact Generator =====")
    print("Press Ctrl+C to stop the program")
    print("======================================")
    
    batch_size = 4  # Generate 4 high-quality facts per batch
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
            print(f"Total facts in database: {len(facts_data['quotes'])}")
            
            # Get a random snippet from the translated Mahabharata text
            mahabharata_snippet = get_random_mahabharata_snippet(500)
            
            if "Error:" in mahabharata_snippet:
                print(f"Error getting translated Mahabharata snippet: {mahabharata_snippet}")
                print("Will try again after a pause.")
                time.sleep(pause_duration)
                continue
            
            # Generate new facts based on the Mahabharata snippet
            new_facts = generate_facts_from_mahabharata(mahabharata_snippet, batch_size)
            
            if not new_facts:
                print("Failed to generate new facts. Will try again after a pause.")
                time.sleep(pause_duration)
                continue
            
            # Track successfully processed facts for commit message
            successful_facts = 0
            
            # Process each new fact
            for i, fact_item in enumerate(new_facts):            
                # Generate a sequential ID based on the highest existing quote number
                next_quote_number = highest_quote_number + successful_facts + 1
                fact_id = f"quote_{next_quote_number}"
                
                # Define image path
                image_filename = f"{fact_id}.png"
                image_path = f"assets/img/quotes/{image_filename}"
                image_url = f"assets/img/quotes/{image_filename}"
                
                # Check if this image already exists, skip if it does
                if os.path.exists(image_path):
                    print(f"Image {image_path} already exists, skipping...")
                    continue
                
                # Generate and save the image
                success = generate_and_save_image(fact_item["image_prompt"], image_path)
                
                # Add to facts data
                if success:
                    facts_data["quotes"].append({
                        "id": fact_id,
                        "quote": fact_item["quote"],
                        "image_prompt": fact_item["image_prompt"],
                        "image_url": image_url,
                        "emphasis": fact_item.get("emphasis", {}),  # Add emphasis data
                        "context": fact_item.get("context", "")  # Add context field
                    })
                    
                    # Increment successful count
                    successful_facts += 1
                    
                    # Save after each successful image generation to preserve progress
                    save_facts(facts_data)
                    
                    # Add a delay to avoid rate limiting
                    time.sleep(2)
                else:
                    print(f"Skipping fact due to image generation failure: {fact_item['quote']}")
            
            # If any facts were generated successfully, commit and push the changes
            if successful_facts > 0:
                git_commit_and_push(successful_facts)
            
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
        print("\nFact generation stopped. Exiting...")
        sys.exit(0)

if __name__ == "__main__":
    main() 