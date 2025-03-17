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

def load_existing_legends():
    """Load existing culinary journey tales from the directory.json file if it exists."""
    json_path = Path("build/assets/data/directory.json")
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

def save_legends(legends_data):
    """Save culinary journey tales data to the directory.json file."""
    json_path = Path("build/assets/data/directory.json")
    with open(json_path, "w") as f:
        json.dump(legends_data, f, indent=2)
    print(f"Saved {len(legends_data['quotes'])} culinary journey tales to {json_path}")

def generate_legends_and_prompts(existing_legends, num_legends=10):
    """Generate Japanese culinary tales and magical Ghibli-style image prompts."""
    
    # Extract existing items to avoid duplicates
    existing_stories = [q["quote"] for q in existing_legends["quotes"]]
    
    # Create the system prompt
    system_prompt = """You are an expert at creating enchanting Japanese culinary journey tales, paired with imaginative Ghibli Art style image prompts.
Generate unique, delightful stories about Japanese food adventures, culinary discoveries, and gastronomic experiences across different regions of Japan that have not been provided before, along with artistic image prompts that interpret these stories through a Ghibli-styled lens.

Each image prompt should start with "Ghibli Art," and you have complete artistic freedom to reimagine these Japanese culinary journeys in the whimsical, magical style of Studio Ghibli.
IMPORTANT REQUIREMENTS FOR EVERY IMAGE PROMPT:
1. Include a Japanese cat breed (such as Japanese Bobtail, Japanese Spitz, or other native Japanese cats) somewhere in the background (different for each image)
2. Include a blonde female chef character, but only in approximately 30% of the images (not in every one)
3. Be imaginative in your descriptions, including vibrant Japanese food scenes, traditional and modern kitchen settings, market places, street food stalls, tea houses, and dining experiences that capture the essence of Japanese culinary culture
4. Vary the settings to include different seasons (spring cherry blossoms, summer festivals, autumn leaves, winter snow), different times of day, different weather conditions, and different locations (rural villages, urban Tokyo, coastal fishing towns, mountain hot spring resorts, etc.)

For each culinary tale, also identify important words that should be emphasized in the animation. There are three levels of emphasis:
- emphasis-1: VERY SPARINGLY used for the single most important word that captures the essence of the tale (use in only 30% of tales)
- emphasis-2: Used only to improve readability for transitional or key descriptive words
- emphasis-3: Used ONLY for words that would be links to other content (these will be styled as links with no-follow and target blank attributes)"""
    
    # Create the user prompt with examples
    user_prompt = f"""Please generate {num_legends} unique and enchanting Japanese culinary journey tales that are not in this list: {existing_stories}.
For each story, create:
1. A brief, captivating Japanese culinary tale (1-3 sentences)
2. A detailed image prompt with complete artistic freedom to reimagine it in Ghibli Art style
3. An emphasis object that marks important words for animation

Include diverse Japanese culinary experiences: 
- Regional specialties (Hokkaido dairy and seafood, Osaka street food, Kyoto refined kaiseki, Okinawan island cuisine, etc.)
- Seasonal dishes (sakura-flavored spring treats, summer cold noodles, autumn mushroom harvests, winter hot pots)
- Different settings (traditional ryokan inns, modern Tokyo restaurants, family kitchens, street food stalls, seaside fish markets)
- Various cooking techniques (fermentation, grilling, steaming, pickling)
- Cultural food traditions (tea ceremonies, seasonal festivals, family recipes passed through generations)

Remember these REQUIREMENTS for every image prompt:
- Include a Japanese cat breed (Japanese Bobtail, Japanese Spitz, etc.) in the background (different for each image)
- Include a blonde female chef character, but only in about 30% of the images
- Maintain the warm, whimsical Ghibli art style
- Include varied Japanese settings, seasons, weather conditions, and times of day

Format your response as a valid JSON array with objects containing:
1. "quote": The Japanese culinary tale (keep this field name as "quote" for compatibility)
2. "image_prompt": A detailed Ghibli Art style image prompt following the requirements
3. "emphasis": An object mapping words to their emphasis level - use emphasis-1 very sparingly (in only 30% of tales), emphasis-2 only for readability, and emphasis-3 only for words that would be links

Example:
{{
    "quote": "In the mountain villages of northern Japan, locals prepare a secret autumn soup where matsutake mushrooms are simmered with pine needles, creating an aromatic broth that's said to extend youth by a decade with each sip.",
    "image_prompt": "Ghibli Art: A steaming cauldron hanging over a rustic hearth in a traditional Japanese mountain home, with golden autumn light streaming through paper windows. An elderly woman gently stirs a broth where matsutake mushrooms and pine needles float. A curious Japanese Bobtail kitten with calico fur watches from atop a wooden stool, its paws batting at the steam. Pine trees visible through the window glow with autumn colors, and tiny soot sprites hide in the kitchen corners. The soup emits a visible, ethereal aroma that forms wispy patterns in the air.",
    "emphasis": {{
        "matsutake": "emphasis-2",
        "mushrooms": "emphasis-2",
        "northern": "emphasis-2",
        "Japan": "emphasis-3",
        "aromatic": "emphasis-2",
        "decade": "emphasis-1"
    }}
}}

Respond with only the JSON array, no additional text."""

    # Generate culinary tales and image prompts
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    print("Generating culinary journey tales and magical image prompts...")
    
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
            new_legends = json.loads(json_str)
        else:
            # Fallback if JSON array not found
            print("JSON array not found in response. Attempting to parse entire response...")
            new_legends = json.loads(response_text)
            
        return new_legends
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
    os.makedirs("build/assets/img/quotes", exist_ok=True)
    os.makedirs("build/assets/data", exist_ok=True)  # Ensure data directory exists too
    
    # Load existing legends
    legends_data = load_existing_legends()
    
    # Find the highest quote number to continue from
    highest_quote_number = get_highest_quote_number(legends_data)
    print(f"Found highest existing quote number: {highest_quote_number}")
    
    # Generate new legends and prompts
    new_legends = generate_legends_and_prompts(legends_data)
    
    if not new_legends:
        print("Failed to generate new culinary journey tales. Exiting.")
        return
    
    # Process each new legend
    for i, legend_item in enumerate(new_legends):
        # Generate a sequential ID based on the highest existing quote number
        next_quote_number = highest_quote_number + i + 1
        legend_id = f"quote_{next_quote_number}"
        
        # Define image path
        image_filename = f"{legend_id}.png"
        image_path = f"build/assets/img/quotes/{image_filename}"
        image_url = f"assets/img/quotes/{image_filename}"
        
        # Check if this image already exists, skip if it does
        if os.path.exists(image_path):
            print(f"Image {image_path} already exists, skipping...")
            continue
        
        # Generate and save the image
        success = generate_and_save_image(legend_item["image_prompt"], image_path)
        
        # Add to legends data
        if success:
            legends_data["quotes"].append({
                "id": legend_id,
                "quote": legend_item["quote"],
                "image_prompt": legend_item["image_prompt"],
                "image_url": image_url,
                "emphasis": legend_item.get("emphasis", {})  # Add emphasis data
            })
            
            # Save after each successful image generation to preserve progress
            save_legends(legends_data)
            
            # Add a delay to avoid rate limiting
            time.sleep(2)
        else:
            print(f"Skipping culinary tale due to image generation failure: {legend_item['quote']}")
    
    print("Culinary journey tales generation and magical image creation complete!")

if __name__ == "__main__":
    main() 