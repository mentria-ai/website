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

def load_existing_stories():
    """Load existing tiny house stories from the directory.json file if it exists."""
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

def save_stories(stories_data):
    """Save tiny house stories data to the directory.json file."""
    json_path = Path("assets/data/directory.json")
    with open(json_path, "w") as f:
        json.dump(stories_data, f, indent=2)
    print(f"Saved {len(stories_data['quotes'])} tiny house stories to {json_path}")

def generate_stories_and_prompts(existing_stories, num_stories=10):
    """Generate tiny house living stories and magical Ghibli-style image prompts."""
    
    # Extract existing items to avoid duplicates
    existing_quotes = [q["quote"] for q in existing_stories["quotes"]]
    
    # Create the system prompt
    system_prompt = """You are an expert at creating enchanting tiny house living stories, paired with imaginative Ghibli Art style image prompts.
Generate unique, delightful stories about tiny house living experiences, innovative space-saving solutions, and the joy of minimalist lifestyles that have not been provided before, along with artistic image prompts that interpret these stories through a Ghibli-styled lens.

Each image prompt should start with "Ghibli Art," and you have complete artistic freedom to reimagine these tiny house living experiences in the whimsical, magical style of Studio Ghibli.
IMPORTANT REQUIREMENTS FOR EVERY IMAGE PROMPT:
1. Include a cat somewhere in the scene, each engaged in a characteristic activity (napping in a sunny window, exploring storage spaces, watching nature through windows, pawing at a butterfly, etc.)
2. Include atmospheric elements like morning mist, golden hour light, or nocturnal starlight to enhance the magical Ghibli feeling
3. Be imaginative in your descriptions, including vibrant tiny home interiors, clever storage solutions, multi-functional furniture, indoor-outdoor connections, and cozy living spaces
4. Vary the settings to include diverse weather conditions beyond standard seasons - misty mornings, summer rainstorms, snowy evenings with northern lights, autumn fog, spring showers
5. For approximately 40% of prompts, highlight sustainable technology (solar panels, rainwater systems, composting) with subtle magical Ghibli interpretations

For each tiny house story, identify important words that should be emphasized in the animation. There are only two levels of emphasis:
- emphasis-1: VERY SPARINGLY used for the single most important word that captures the essence of the story (use in only 30% of stories). This will be highlighted in gold color.
- emphasis-2: Used only to improve readability for transitional or key descriptive words (include 'cleverly', 'ingeniously', 'thoughtfully' to highlight intentional design). This will be underlined.

Each story should emphasize one emotional benefit of tiny living (freedom, connection, simplicity, peace, creativity)."""
    
    # Create the user prompt with examples
    user_prompt = f"""Please generate {num_stories} unique and enchanting tiny house living stories that are not in this list: {existing_quotes}.
For each story, create:
1. A brief, captivating tiny house living tale (1-3 sentences)
2. A detailed image prompt with complete artistic freedom to reimagine it in Ghibli Art style
3. An emphasis object that marks important words for animation

Include diverse tiny house experiences: 
- Different tiny house styles (converted vans, shipping containers, micro-apartments, cabin-style tiny houses, treehouse tiny homes)
- Seasonal adaptations (insulation for winter, ventilation for summer, rainwater collection in spring, autumn garden harvesting)
- Different settings (forest retreats, beachfront tiny houses, urban micro-living, mountaintop cabins, off-grid tiny homes)
- Innovative solutions (multi-functional furniture, vertical storage, loft bedrooms, transforming spaces, composting toilets)
- Lifestyle benefits (financial freedom, environmental impact, mobility, community connection, simplified living)
- Emotional benefits (freedom, connection, simplicity, peace, creativity)

Remember these REQUIREMENTS for every image prompt:
- Include a cat engaged in a characteristic behavior (different for each image)
- Include atmospheric elements (morning mist, golden hour light, nocturnal starlight, etc.)  
- Maintain the warm, whimsical Ghibli art style with magical elements
- Include varied tiny house settings, weather conditions, and times of day
- For 40% of prompts, highlight sustainable technology with subtle magical Ghibli interpretations

Format your response as a valid JSON array with objects containing:
1. "quote": The tiny house living story (keep this field name as "quote" for compatibility)
2. "image_prompt": A detailed Ghibli Art style image prompt following the requirements
3. "emphasis": An object mapping words to their emphasis level - use emphasis-1 very sparingly for color highlighting (in only 30% of stories), and emphasis-2 for underlining key descriptive words (including 'cleverly', 'ingeniously', 'thoughtfully')

Example:
{{
    "quote": "In a converted vintage bus nestled in a mountain meadow, every inch is ingeniously designed - kitchen shelves fold into dining tables, stairs double as storage drawers, and the rooftop garden provides fresh herbs year-round.",
    "image_prompt": "Ghibli Art: A magical converted vintage bus tiny home in a serene mountain meadow bathed in golden hour light. Sunlight streams through colorful stained glass windows onto cleverly designed interiors where kitchen shelves transform into a dining table. A spiral staircase with drawers built into each step leads to a loft bedroom. On the rooftop, a thriving herb garden grows with sprigs of rosemary and basil swaying in the gentle breeze. A curious tabby cat explores the herb garden, pawing at a floating seed pod. The mountains in the background are painted in soft purples and blues, with tiny clouds casting dappled shadows on the meadow as mist rises from the valley below.",
    "emphasis": {{
        "vintage": "emphasis-2",
        "bus": "emphasis-2",
        "ingeniously": "emphasis-2",
        "storage": "emphasis-2",
        "freedom": "emphasis-1"
    }}
}}

Respond with only the JSON array, no additional text."""

    # Generate tiny house stories and image prompts
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ]
    
    print("Generating tiny house living stories and magical image prompts...")
    
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
            new_stories = json.loads(json_str)
        else:
            # Fallback if JSON array not found
            print("JSON array not found in response. Attempting to parse entire response...")
            new_stories = json.loads(response_text)
            
        return new_stories
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
    
    # Load existing stories
    stories_data = load_existing_stories()
    
    # Find the highest quote number to continue from
    highest_quote_number = get_highest_quote_number(stories_data)
    print(f"Found highest existing quote number: {highest_quote_number}")
    
    # Generate new stories and prompts
    new_stories = generate_stories_and_prompts(stories_data)
    
    if not new_stories:
        print("Failed to generate new tiny house stories. Exiting.")
        return
    
    # Process each new story
    for i, story_item in enumerate(new_stories):
        # Generate a sequential ID based on the highest existing quote number
        next_quote_number = highest_quote_number + i + 1
        story_id = f"quote_{next_quote_number}"
        
        # Define image path
        image_filename = f"{story_id}.png"
        image_path = f"assets/img/quotes/{image_filename}"
        image_url = f"assets/img/quotes/{image_filename}"
        
        # Check if this image already exists, skip if it does
        if os.path.exists(image_path):
            print(f"Image {image_path} already exists, skipping...")
            continue
        
        # Generate and save the image
        success = generate_and_save_image(story_item["image_prompt"], image_path)
        
        # Add to stories data
        if success:
            stories_data["quotes"].append({
                "id": story_id,
                "quote": story_item["quote"],
                "image_prompt": story_item["image_prompt"],
                "image_url": image_url,
                "emphasis": story_item.get("emphasis", {})  # Add emphasis data
            })
            
            # Save after each successful image generation to preserve progress
            save_stories(stories_data)
            
            # Add a delay to avoid rate limiting
            time.sleep(2)
        else:
            print(f"Skipping tiny house story due to image generation failure: {story_item['quote']}")
    
    print("Tiny house stories generation and magical image creation complete!")

if __name__ == "__main__":
    main() 