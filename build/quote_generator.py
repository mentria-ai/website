import os
import json
import base64
import time
import signal
import sys
import subprocess
import re
import numpy as np
from pathlib import Path
from dotenv import load_dotenv
from together import Together
import random
from sklearn.metrics.pairwise import cosine_similarity

# Load environment variables
load_dotenv()

# Initialize Together API client
client = Together()

# Flag to control infinite loop
running = True

# Handle Ctrl+C gracefully
def signal_handler(sig, frame):
    global running
    print("\nCtrl+C detected! Finishing current batch and exiting...")
    running = False

# Register the signal handler
signal.signal(signal.SIGINT, signal_handler)

def load_existing_facts():
    """Load existing 'Did You Know' facts from the directory.json file if it exists."""
    json_path = Path("assets/data/directory.json")
    if json_path.exists():
        with open(json_path, "r") as f:
            return json.load(f)
    return {"quotes": [], "embeddings": {}}

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
    
    # Create a copy without embeddings for the actual JSON file to keep it smaller
    facts_to_save = {"quotes": facts_data["quotes"]}
    
    # Save the actual facts data
    with open(json_path, "w") as f:
        json.dump(facts_to_save, f, indent=2)
    print(f"Saved {len(facts_data['quotes'])} fascinating facts to {json_path}")
    
    # Save embeddings separately
    embeddings_path = Path("assets/data/embeddings.json")
    with open(embeddings_path, "w") as f:
        json.dump(facts_data["embeddings"], f)
    print(f"Saved embeddings to {embeddings_path}")

def git_commit_and_push(num_new_facts):
    """Commit the latest changes and push to the repository."""
    try:
        print("\nCommitting and pushing changes to the repository...")
        
        # Stage the changes
        subprocess.run(["git", "add", "assets/data/directory.json", "assets/img/quotes/"], check=True)
        
        # Create a descriptive commit message
        commit_message = f"Add {num_new_facts} new 'Did You Know' facts with Ghibli art"
        subprocess.run(["git", "commit", "-m", commit_message], check=True)
        
        # Push to the repository (assuming 'main' branch)
        subprocess.run(["git", "push", "origin", "main"], check=True)
        
        print("✓ Successfully committed and pushed new facts to the repository!")
    except subprocess.CalledProcessError as e:
        print(f"Error during Git operations: {e}")
    except Exception as e:
        print(f"Unexpected error during Git operations: {e}")

def generate_embedding(text):
    """Generate embeddings for a given text using Together API."""
    try:
        # Clean the text for better embedding
        text = text.replace("Did you know? ", "").strip()
        
        response = client.embeddings.create(
            model="togethercomputer/m2-bert-80M-32k-retrieval",
            input=text,
        )
        return response.data[0].embedding
    except Exception as e:
        print(f"Error generating embedding: {e}")
        return None

def calculate_similarity(embedding1, embedding2):
    """Calculate cosine similarity between two embeddings."""
    # Reshape embeddings for sklearn's cosine_similarity
    emb1 = np.array(embedding1).reshape(1, -1)
    emb2 = np.array(embedding2).reshape(1, -1)
    return cosine_similarity(emb1, emb2)[0][0]

def is_semantically_similar(new_fact, facts_data, similarity_threshold=0.85):
    """
    Check if a new fact is semantically similar to any existing facts using embeddings.
    
    Args:
        new_fact (str): The new fact to check.
        facts_data (dict): Dictionary containing existing facts and embeddings.
        similarity_threshold (float): Threshold for considering two facts as similar (0-1).
        
    Returns:
        bool: True if the fact is semantically similar to existing ones, False otherwise.
    """
    # Generate embedding for the new fact
    new_embedding = generate_embedding(new_fact)
    if not new_embedding:
        # If we can't generate embedding, fall back to allowing the fact
        return False
    
    # Initialize embeddings dictionary if it doesn't exist
    if "embeddings" not in facts_data:
        facts_data["embeddings"] = {}
    
    # Check similarity against all existing embeddings
    for quote_id, embedding in facts_data["embeddings"].items():
        similarity = calculate_similarity(new_embedding, embedding)
        
        if similarity >= similarity_threshold:
            # Find the corresponding text for better debugging
            quote_text = "Unknown"
            for quote in facts_data["quotes"]:
                if quote["id"] == quote_id:
                    quote_text = quote["quote"]
                    break
                    
            print(f"Semantic duplicate detected! Similarity: {similarity:.2f}")
            print(f"New     : {new_fact}")
            print(f"Existing: {quote_text} (ID: {quote_id})")
            return True
    
    # Store the new embedding for future reference
    facts_data["embeddings"][f"temp_embedding_{len(facts_data['embeddings'])}"] = new_embedding
    return False

def find_diverse_topics(facts_data, num_clusters=5):
    """
    Analyze existing facts to identify underrepresented topic areas.
    Returns a list of topic suggestions for generating more diverse facts.
    """
    if len(facts_data["quotes"]) < 10 or "embeddings" not in facts_data or len(facts_data["embeddings"]) < 10:
        # Not enough data for meaningful clustering
        return ["science", "history", "geography", "art", "culture", "technology", "space", "animals"]
    
    try:
        from sklearn.cluster import KMeans
        
        # Collect all embeddings
        embeddings_list = list(facts_data["embeddings"].values())
        embeddings_array = np.array(embeddings_list)
        
        # Determine optimal number of clusters (at most 20% of data points or 15, whichever is smaller)
        max_clusters = min(15, len(embeddings_array) // 5)
        num_clusters = min(num_clusters, max_clusters)
        
        # Perform K-means clustering
        kmeans = KMeans(n_clusters=num_clusters, random_state=42)
        cluster_labels = kmeans.fit_predict(embeddings_array)
        
        # Count facts in each cluster
        cluster_counts = np.bincount(cluster_labels)
        
        # Find the least populated clusters (underrepresented topics)
        underrepresented_clusters = np.argsort(cluster_counts)[:3]
        
        # Use the centroids of these clusters to query for new, diverse facts
        diverse_topics = []
        
        # Map from cluster indices to general topics (a simplified approach)
        general_topics = [
            "astronomy and space exploration",
            "biology and medicine",
            "physics and chemistry",
            "history and archaeology",
            "geography and geology", 
            "technology and engineering",
            "culture and anthropology",
            "art and literature",
            "mathematics and statistics",
            "marine biology and oceanography",
            "environmental science",
            "psychology and neuroscience",
            "economics and trade",
            "linguistics and languages",
            "sports and games"
        ]
        
        # Return a mix of underrepresented topics and some standard diverse topics
        diverse_topics = [general_topics[i % len(general_topics)] for i in underrepresented_clusters]
        diverse_topics.extend(random.sample([t for t in general_topics if t not in diverse_topics], 2))
        
        return diverse_topics
        
    except Exception as e:
        print(f"Error in topic diversity analysis: {e}")
        # Fallback to basic topics
        return ["science", "history", "geography", "art", "culture"]

def generate_facts_and_prompts(facts_data, num_facts=5):
    """Generate surprising 'Did You Know' facts and magical Ghibli-style image prompts."""
    
    # Extract existing items to avoid duplicates
    existing_quotes = [q["quote"] for q in facts_data["quotes"]]
    
    # Only use the last 100 quotes in the prompt to keep size manageable
    recent_quotes = existing_quotes[-100:] if len(existing_quotes) > 100 else existing_quotes
    
    # Identify underrepresented topics for more diverse fact generation
    diverse_topics = find_diverse_topics(facts_data)
    topic_suggestions = ", ".join(diverse_topics)
    
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
    
    # Create the user prompt with examples and topic guidance
    user_prompt = f"""Please generate {num_facts} unique and fascinating "Did You Know" facts that are not in this list: {recent_quotes}.
For each fact, create:
1. A brief, surprising fact (15-40 words MAX)
2. A detailed image prompt with complete artistic freedom to reimagine it in Ghibli Art style
3. An emphasis object that marks important words for animation

IMPORTANT: Based on analysis of our existing facts, we need MORE facts about these underrepresented topics: {topic_suggestions}. Please include facts from these areas.

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
    global running
    
    # Create necessary directories
    os.makedirs("assets/img/quotes", exist_ok=True)
    os.makedirs("assets/data", exist_ok=True)
    
    print("===== Infinite Fact Generator with Auto-Commit =====")
    print("Press Ctrl+C to stop the program")
    print("==================================================")
    
    batch_size = 7  # Number of facts to generate in each batch
    pause_duration = 1800  # Seconds to pause between batches (30 minutes)
    batch_count = 0
    
    # Run indefinitely until interrupted
    while running:
        batch_count += 1
        print(f"\n--- Starting Batch #{batch_count} ---")
        
        # Load existing facts (reload each time to ensure we have the latest)
        facts_data = load_existing_facts()
        
        # Initialize embeddings dict if it doesn't exist
        if "embeddings" not in facts_data:
            facts_data["embeddings"] = {}
            
        # If we have facts but no embeddings, generate them
        if len(facts_data["quotes"]) > 0 and len(facts_data["embeddings"]) == 0:
            print("Generating embeddings for existing facts...")
            for quote in facts_data["quotes"]:
                quote_id = quote["id"]
                quote_text = quote["quote"]
                embedding = generate_embedding(quote_text)
                if embedding:
                    facts_data["embeddings"][quote_id] = embedding
                time.sleep(0.2)  # Avoid rate limiting
        
        # Find the highest quote number to continue from
        highest_quote_number = get_highest_quote_number(facts_data)
        print(f"Found highest existing quote number: {highest_quote_number}")
        print(f"Total facts in database: {len(facts_data['quotes'])}")
        
        # Generate new facts and prompts
        new_facts = generate_facts_and_prompts(facts_data, batch_size)
        
        if not new_facts:
            print("Failed to generate new 'Did You Know' facts. Will try again after a pause.")
            time.sleep(pause_duration)
            continue
        
        # Track successfully processed facts for commit message
        successful_facts = 0
        
        # Process each new fact
        for i, fact_item in enumerate(new_facts):
            if not running:
                break  # Exit the loop if Ctrl+C was pressed
            
            # Skip if the fact is semantically similar to existing facts
            if is_semantically_similar(fact_item["quote"], facts_data):
                print(f"Skipping semantically similar fact: {fact_item['quote'][:50]}...")
                continue
                
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
                    "emphasis": fact_item.get("emphasis", {})  # Add emphasis data
                })
                
                # Generate and store embedding with the correct ID
                embedding = generate_embedding(fact_item["quote"])
                if embedding:
                    # Replace the temporary embedding with the proper quote ID
                    temp_key = f"temp_embedding_{len(facts_data['embeddings']) - 1}"
                    if temp_key in facts_data["embeddings"]:
                        del facts_data["embeddings"][temp_key]
                    facts_data["embeddings"][fact_id] = embedding
                
                # Increment successful count
                successful_facts += 1
                
                # Save after each successful image generation to preserve progress
                save_facts(facts_data)
                
                # Add a delay to avoid rate limiting
                time.sleep(2)
            else:
                print(f"Skipping 'Did You Know' fact due to image generation failure: {fact_item['quote']}")
        
        # If any facts were generated successfully, commit and push the changes
        if successful_facts > 0:
            git_commit_and_push(successful_facts)
        
        # If we're still running, pause before the next batch
        if running:
            print(f"\nBatch #{batch_count} complete! Waiting 30 minutes before next batch...")
            print(f"(Press Ctrl+C to exit)")
            
            # Show a countdown timer during the wait
            remaining = pause_duration
            while remaining > 0 and running:
                mins = remaining // 60
                secs = remaining % 60
                print(f"\rNext batch in: {mins:02d}:{secs:02d}", end="")
                time.sleep(1)
                remaining -= 1
            
            print("\rWait complete. Starting next batch...                ")
    
    print("\n'Did You Know' fact generation stopped. Exiting...")

if __name__ == "__main__":
    main() 