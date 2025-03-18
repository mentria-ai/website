import os
import json
import base64
import time
from pathlib import Path
from dotenv import load_dotenv
from together import Together
import random

# Load environment variables
load_dotenv()

# Initialize Together API client
client = Together()

def load_existing_facts():
    """Load existing 'Did You Know' facts from the directory.json file if it exists."""
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
    """Save 'Did You Know' facts data to the directory.json file."""
    json_path = Path("assets/data/directory.json")
    with open(json_path, "w") as f:
        json.dump(facts_data, f, indent=2)
    print(f"Saved {len(facts_data['quotes'])} fascinating facts to {json_path}")

def generate_facts_and_prompts(existing_facts, num_facts=5):
    """Generate surprising 'Did You Know' facts and magical Ghibli-style image prompts."""
    
    # Extract existing items to avoid duplicates
    existing_quotes = [q["quote"] for q in existing_facts["quotes"]]
    
    # Create the system prompt
    system_prompt = """You are an expert at creating engaging, surprising, and fun "Did You Know" facts, paired with imaginative Ghibli Art style image prompts.
Generate unique, fascinating facts from a variety of domains (science, history, nature, geography, art, culture, etc.) that have not been provided before, along with artistic image prompts that illustrate these facts through a Ghibli-styled lens.

Each fact should be concise (15-40 words MAX) but captivating, aiming to evoke wonder, curiosity, or amazement.

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
    
    # Create the user prompt with examples
    user_prompt = f"""Please generate {num_facts} unique and fascinating "Did You Know" facts that are not in this list: {existing_quotes}.
For each fact, create:
1. A brief, surprising fact (15-40 words MAX)
2. A detailed image prompt with complete artistic freedom to reimagine it in Ghibli Art style
3. An emphasis object that marks important words for animation

Include diverse facts from these categories: 
- Natural wonders and wildlife behaviors
- Surprising historical events or discoveries
- Unexpected science and technology facts
- Fascinating cultural customs from around the world
- Strange but true human body facts
- Astronomical or space-related discoveries
- Animal kingdom oddities and superpowers
- Unexpected geographical features

Remember these REQUIREMENTS for every image prompt:
- Create Ghibli-style art that clearly illustrates the fact
- Include atmospheric elements (mist, unique lighting, magical weather)
- Include relevant animals when appropriate to the fact
- Use vibrant, whimsical settings that make the fact visually engaging
- Add small magical touches that enhance the wonder of the fact

Format your response as a valid JSON array with objects containing:
1. "quote": The "Did You Know" fact (keep this field name as "quote" for compatibility)
2. "image_prompt": A detailed Ghibli Art style image prompt following the requirements
3. "emphasis": An object mapping words to their emphasis level - use emphasis-1 very sparingly for color highlighting (in only 30% of facts), and emphasis-2 for underlining key terms

Example:
{{
    "quote": "Did you know? Octopuses have three hearts, blue blood, and can change their skin color and texture in just 200 milliseconds to match their surroundings.",
    "image_prompt": "Ghibli Art: An intelligent octopus with three visible, gently glowing hearts inside its translucent body, lounging on a vibrant coral reef. Its skin shifts between patterns and textures, perfectly mimicking the colorful reef beneath. Shafts of golden sunlight filter through turquoise water, creating dancing patterns. Tiny, curious fish with exaggerated expressions watch in amazement as the octopus demonstrates its camouflage. Magical blue particles swirl around its blue blood vessels, visible through its skin when it changes to a translucent state.",
    "emphasis": {{
        "three hearts": "emphasis-2",
        "blue blood": "emphasis-2",
        "200 milliseconds": "emphasis-1",
        "change": "emphasis-2"
    }}
}}

Respond with only the JSON array, no additional text."""

    # Generate facts and image prompts
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    print("Generating fascinating 'Did You Know' facts and magical image prompts...")
    
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
        
        response = client.images.generate(
            prompt=prompt,
            model="black-forest-labs/FLUX.1-dev-lora",
            width=832,
            height=1440,
            steps=30,
            n=1,
            response_format="b64_json",
            image_loras=[{"path":"https://huggingface.co/strangerzonehf/Flux-Ghibli-Art-LoRA/resolve/main/Ghibli-Art.safetensors?download=true","scale":1}]
        )
        
        # Save the image
        img_data = base64.b64decode(response.data[0].b64_json)
        with open(image_path, 'wb') as f:
            f.write(img_data)
        
        print(f"Image saved to {image_path}")
        return True
    except Exception as e:
        print(f"Error generating image: {e}")
        return False

def main():
    # Create necessary directories
    os.makedirs("assets/img/quotes", exist_ok=True)
    os.makedirs("assets/data", exist_ok=True)  # Ensure data directory exists too
    
    # Load existing facts
    facts_data = load_existing_facts()
    
    # Find the highest quote number to continue from
    highest_quote_number = get_highest_quote_number(facts_data)
    print(f"Found highest existing quote number: {highest_quote_number}")
    
    # Generate new facts and prompts - limit to 7 facts per batch
    new_facts = generate_facts_and_prompts(facts_data, num_facts=7)
    
    if not new_facts:
        print("Failed to generate new 'Did You Know' facts. Exiting.")
        return
    
    # Process each new fact
    for i, fact_item in enumerate(new_facts):
        # Generate a sequential ID based on the highest existing quote number
        next_quote_number = highest_quote_number + i + 1
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
                "emphasis": fact_item.get("emphasis", {})  # Add emphasis data
            })
            
            # Save after each successful image generation to preserve progress
            save_facts(facts_data)
            
            # Add a delay to avoid rate limiting
            time.sleep(2)
        else:
            print(f"Skipping 'Did You Know' fact due to image generation failure: {fact_item['quote']}")
    
    print("'Did You Know' fact generation and magical image creation complete!")

def run_forever():
    """Run the fact generator continuously until interrupted with Ctrl+C."""
    import signal
    
    # Define signal handler for Ctrl+C
    def signal_handler(sig, frame):
        print("\nCtrl+C detected. Exiting after current batch completes...")
        signal.signal(signal.SIGINT, original_handler)  # Restore original handler
    
    # Save the original handler to restore later
    original_handler = signal.getsignal(signal.SIGINT)
    
    try:
        # Set our custom handler
        signal.signal(signal.SIGINT, signal_handler)
        
        print("===== Infinite Fact Generator =====")
        print("Press Ctrl+C to stop after current batch")
        print("===================================")
        
        batch_count = 0
        while True:
            batch_count += 1
            print(f"\n--- Starting Batch #{batch_count} ---")
            main()  # Run the main function
            
            # Pause between batches - 30 minutes
            pause_time = 1800  # seconds (30 minutes)
            print(f"\nBatch #{batch_count} complete! Waiting 30 minutes before next batch...")
            print("(Press Ctrl+C to exit)")
            
            # Show a countdown timer during the wait
            remaining = pause_time
            while remaining > 0:
                mins = remaining // 60
                secs = remaining % 60
                print(f"\rNext batch in: {mins:02d}:{secs:02d}", end="")
                time.sleep(1)
                remaining -= 1
                
                # Check for Ctrl+C during the countdown
                if signal.getsignal(signal.SIGINT) != signal_handler:
                    break
            
            print("\rWait complete. Starting next batch...                ")
            
    except KeyboardInterrupt:
        # This will catch any Ctrl+C not caught by the signal handler
        pass
    finally:
        # Restore the original signal handler
        signal.signal(signal.SIGINT, original_handler)
        print("\nInfinite fact generation stopped. Goodbye!")

if __name__ == "__main__":
    # Use run_forever() to run continuously, or main() for a single batch
    run_forever() 