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

def get_random_mahabharata_snippet(word_count=1000):
    """Read a random snippet from the Mahabharata text file."""
    print("Reading random snippet from Mahabharata text...")
    
    mahabharata_path = Path("assets/data/reference/mahabharata.txt")
    
    if not mahabharata_path.exists():
        print(f"Error: Mahabharata text file not found at {mahabharata_path}")
        return "Error: Mahabharata text file not found."
    
    # Get file size
    file_size = mahabharata_path.stat().st_size
    
    # Choose a random position in the file
    with open(mahabharata_path, 'r', encoding='utf-8', errors='ignore') as file:
        # Make sure we don't start too close to the end of the file
        max_start_pos = max(0, file_size - 50000)  # Stay at least 50KB from the end
        if max_start_pos <= 0:
            # File is small enough to just read it all
            content = file.read()
        else:
            # Start at a random position
            start_pos = random.randint(0, max_start_pos)
            file.seek(start_pos)
            
            # Read a line to make sure we start at the beginning of a line
            file.readline()
            
            # Read the snippet
            content = file.read(100000)  # Read a larger chunk to ensure we get enough words
    
    # Split into words and take approximately the desired count
    words = content.split()
    if len(words) > word_count:
        words = words[:word_count]
    
    # Rejoin into a string
    snippet = ' '.join(words)
    
    print(f"Read {len(words)} words from Mahabharata text.")
    return snippet

def generate_facts_from_mahabharata(mahabharata_snippet, num_facts=7):
    """Generate facts based on a snippet from the Mahabharata text."""
    
    # Create the system prompt
    system_prompt = """You are an expert at creating engaging, surprising, and interesting facts based on ancient texts, paired with imaginative Ghibli Art style image prompts.
Generate unique, fascinating facts based on the provided ancient text snippet. These facts should be intriguing, educational, and captivating. Each fact should be accompanied by an artistic image prompt that illustrates it through a Ghibli-styled lens.

Each fact should be concise (15-40 words MAX) but captivating, aiming to evoke wonder, curiosity, or amazement.

Important: Do NOT explicitly mention that these facts are from the Mahabharata or any specific text. Present them as general interesting facts.

Each image prompt should start with "Ghibli Art:" and you have complete artistic freedom to reimagine these facts in the whimsical, magical style of Studio Ghibli.
IMPORTANT REQUIREMENTS FOR EVERY IMAGE PROMPT:
1. Create a scene that clearly illustrates the fact in a visually engaging way
2. Include atmospheric elements like morning mist, golden hour light, or fantastical weather to enhance the magical Ghibli feeling
3. If relevant, incorporate animals that relate to the fact in charming, whimsical ways
4. Use vibrant settings, magical elements, and warm color palettes characteristic of Ghibli films
5. Add small magical touches like glowing particles, tiny creatures, or enchanted natural elements that relate to the fact

For each fact, identify important words that should be emphasized in the animation. There are only two levels of emphasis:
- emphasis-1: VERY SPARINGLY used for the single most important word that captures the essence of the fact (use in only 30% of facts). This will be highlighted in gold color.
- emphasis-2: Used only for key terms or transitional words that improve readability. This will be underlined.

Each fact should evoke a sense of wonder, surprise, or delight in the reader."""
    
    # Create the user prompt
    user_prompt = f"""Based on the following ancient text snippet, please generate {num_facts} unique and fascinating facts.

ANCIENT TEXT SNIPPET:
```
{mahabharata_snippet}
```

For each fact, create:
1. A brief, surprising fact (15-40 words MAX) that is grounded in the actual text
2. A detailed image prompt with complete artistic freedom to reimagine it in Ghibli Art style
3. An emphasis object that marks important words for animation
4. A context field (120-150 words) that THOROUGHLY explains which part of the text supports this fact

IMPORTANT REQUIREMENTS:
- Do NOT explicitly mention that these facts are from any specific text. Present them as general interesting facts about history, mythology, or culture.
- Make the facts sensational yet grounded in the actual text provided.
- Facts should be diverse, covering different aspects found in the text.
- Each fact should be concise but captivating.
- The context field is CRITICAL - it must provide concrete evidence from the text that supports the fact:
  * Include specific phrases, quotations, or descriptions from the text
  * Explain how these textual elements support the fact being presented
  * Provide enough detail to show the fact is authentic and not invented
  * If the fact involves any embellishment or interpretation, clearly explain how it relates to the original text

Remember these REQUIREMENTS for every image prompt:
- Create Ghibli-style art that clearly illustrates the fact
- Include atmospheric elements (mist, unique lighting, magical weather)
- Include relevant characters and creatures in a whimsical Ghibli style
- Use vibrant, whimsical settings that make the fact visually engaging
- Add small magical touches that enhance the wonder of the fact

Format your response as a valid JSON array with objects containing:
1. "quote": The fact (keep this field name as "quote" for compatibility)
2. "image_prompt": A detailed Ghibli Art style image prompt following the requirements
3. "emphasis": An object mapping words to their emphasis level - use emphasis-1 very sparingly for color highlighting (in only 30% of facts), and emphasis-2 for underlining key terms
4. "context": Detailed explanation (120-150 words) of which part of the text supports this fact, with specific textual evidence

Example:
{{
    "quote": "Did you know? Warriors of ancient times would often perform elaborate rituals before battle, believing these ceremonies would provide divine protection.",
    "image_prompt": "Ghibli Art: A young warrior in ornate armor kneeling under a massive, ancient tree at dawn. Golden light filters through misty air as they perform a ceremonial ritual with sacred objects. Small spirits peek from behind leaves, and magical particles float around a sword planted in front of them. The landscape features rolling hills dotted with temples in the distance, all rendered in warm, watercolor-like Ghibli style.",
    "emphasis": {{
        "elaborate rituals": "emphasis-2",
        "divine protection": "emphasis-1"
    }},
    "context": "The text describes in detail how warriors 'would perform sacred rites before entering the battlefield' and mentions specific rituals like 'offering prayers to the deities of war' and 'purifying their weapons with sacred water and mantras.' It explicitly states that 'these ceremonies were believed to create an invisible armor around the warrior' and that 'no weapon could pierce through this divine protection.' The text further elaborates how one particular warrior performed a ritual lasting seven days and nights, after which he emerged victorious in a battle against overwhelming odds, which was attributed to the protection granted by the ritual. These specific descriptions provide concrete evidence for the ceremonial practices and beliefs about divine protection in ancient warfare."
}}

Respond with only the JSON array, no additional text."""

    # Generate facts based on the Mahabharata snippet
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    print("Generating fascinating facts based on Mahabharata snippet...")
    
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
    
    print("===== Mahabharata Fact Generator with Auto-Commit =====")
    print("Press Ctrl+C to stop the program")
    print("======================================================")
    
    batch_size = 7  # Number of facts to generate in each batch
    pause_duration = 1800  # Seconds to pause between batches (30 minutes)
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
            
            # Get a random snippet from the Mahabharata text
            mahabharata_snippet = get_random_mahabharata_snippet(1000)
            
            if "Error:" in mahabharata_snippet:
                print(f"Error getting Mahabharata snippet: {mahabharata_snippet}")
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
            
            print(f"\nBatch #{batch_count} complete! Waiting 30 minutes before next batch...")
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