import requests
import json
import time
import os
import sys
import base64
import urllib.parse
import uuid
import websocket
import urllib.request
from together import Together
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))), '.env'))
TOGETHER_API_KEY = os.getenv('TOGETHER_API_KEY')

# Initialize Together client
client = Together()

def get_quote_info(image_filename):
    """Get quote and image prompt information from directory.json for a given image filename"""
    try:
        # Load directory.json
        directory_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'directory.json')
        with open(directory_path, 'r', encoding='utf-8') as f:
            directory = json.load(f)
        
        # Extract image ID from filename (e.g., quote_61.png -> quote_61)
        image_id = os.path.splitext(image_filename)[0]
        
        # Find matching quote in directory
        for quote in directory['quotes']:
            if quote['id'] == image_id:
                return quote
        
        return None
    except Exception as e:
        print(f"Error reading directory.json: {e}")
        return None

def generate_video_prompt(image_path, quote_info):
    """Generate a video prompt using Together API"""
    try:
        # Read and encode the image file in base64
        with open(image_path, 'rb') as img_file:
            image_data = img_file.read()
            image_base64 = base64.b64encode(image_data).decode('utf-8')
            
            # Create the API request with base64 encoded image
            response = client.chat.completions.create(
                model="meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": f"""TASK: Create an ultra-simple animation prompt for this image with slow motion.

FORMAT: Give me only 2-3 simple movement descriptions separated by commas. For example: "crabs walking slowly, waves gently splashing, clouds drifting"

RULES:
- Just list what elements should move in the image
- Must include words like "slow", "gentle", "gradual", or "subtle" for at least one movement
- No complete sentences, just phrases
- Maximum 5-6 words total
- Focus on movements that relate to this quote: "{quote_info['quote']}"

EXAMPLE OUTPUT:
leaves slowly falling, water gently rippling, subtle wind effects"""
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{image_base64}"
                                }
                            }
                        ]
                    }
                ]
            )
        
        # Extract the generated prompt
        generated_prompt = response.choices[0].message.content
        
        # Simplify processing - extract just the movement descriptions
        # Remove any headers, explanations, or formatting
        lines = generated_prompt.split('\n')
        simplified_prompt = ""
        
        for line in lines:
            # Skip lines with common headers
            if any(header in line.lower() for header in ["animation prompt:", "output:", "example:", "here's", "simple"]):
                continue
                
            # If the line has actual content, it's likely our prompt
            if len(line.strip()) > 0 and "," in line and len(line.strip().split(",")) >= 2:
                simplified_prompt = line.strip()
                break
        
        # If we couldn't find a good line with commas, just take the shortest non-empty line
        if not simplified_prompt:
            content_lines = [line.strip() for line in lines if len(line.strip()) > 0]
            if content_lines:
                # Sort by length and take the shortest that makes sense as a prompt
                content_lines.sort(key=len)
                for line in content_lines:
                    if len(line) > 10 and len(line) < 100:  # Reasonable prompt length
                        simplified_prompt = line
                        break
                        
                # If still no good line, just take the first content line
                if not simplified_prompt and content_lines:
                    simplified_prompt = content_lines[0]
        
        # Further simplify - remove extra spaces, dots at the end, etc.
        simplified_prompt = simplified_prompt.strip()
        simplified_prompt = simplified_prompt.rstrip(".")
        simplified_prompt = simplified_prompt.replace("; ", ", ")
        
        # Force lowercase for the style requested
        simplified_prompt = simplified_prompt.lower()
        
        # Check if the prompt has slow motion words, if not add them
        slow_motion_words = ["slow", "gentle", "gradual", "subtle", "slowly", "gently"]
        if not any(word in simplified_prompt for word in slow_motion_words):
            # Add slow motion to the first movement
            parts = simplified_prompt.split(", ")
            if parts:
                # Modify the first part to include "slowly"
                if " " in parts[0]:
                    # Insert "slowly" before the verb
                    words = parts[0].split()
                    parts[0] = words[0] + " slowly " + " ".join(words[1:])
                else:
                    parts[0] = "slowly " + parts[0]
                
                simplified_prompt = ", ".join(parts)
        
        # Return the ultra-simple prompt
        print(f"Original response: {generated_prompt}")
        print(f"Simplified to: {simplified_prompt}")
        
        return simplified_prompt
    except Exception as e:
        print(f"Error generating video prompt: {e}")
        return None

def process_image_to_video(image_path):
    """Process a single image to generate a video"""
    try:
        # Get quote info
        image_filename = os.path.basename(image_path)
        quote_info = get_quote_info(image_filename)
        
        if not quote_info:
            print(f"Could not find quote info for {image_filename}")
            return False
        
        # Generate video prompt
        print(f"\nGenerating video prompt for {image_filename}...")
        video_prompt = generate_video_prompt(image_path, quote_info)
        
        if not video_prompt:
            print(f"Failed to generate video prompt for {image_filename}")
            return False
            
        # Display the final video prompt
        print("\n============ FINAL VIDEO PROMPT ============")
        print(video_prompt)
        print("============================================\n")
        
        # Upload image to ComfyUI server
        print("\nUploading image to ComfyUI server...")
        try:
            # Prepare the image upload request
            files = {
                'image': (os.path.basename(image_path), open(image_path, 'rb'), 'image/png')
            }
            
            # Upload the image using the correct endpoint
            upload_url = f"{COMFY_API_URL}/api/upload/image"
            upload_response = requests.post(upload_url, files=files)
            
            if upload_response.status_code != 200:
                print(f"Upload response: {upload_response.text}")
                raise Exception(f"Image upload failed with status code {upload_response.status_code}")
            
            # Get the uploaded image information
            upload_result = upload_response.json()
            print(f"Image uploaded successfully: {upload_result}")
            
            # Determine the path to the uploaded image for the workflow
            uploaded_image_path = upload_result.get('name')
            if upload_result.get('subfolder'):
                uploaded_image_path = f"{upload_result['subfolder']}/{uploaded_image_path}"
            
            # Update workflow with uploaded image path
            if "58" in workflow and "inputs" in workflow["58"]:
                workflow["58"]["inputs"]["image"] = uploaded_image_path
                print(f"Updated workflow with uploaded image: {uploaded_image_path}")
            else:
                print("WARNING: Could not find image node in workflow to update")
                return False
                
        except Exception as e:
            print(f"ERROR: Failed to upload image to ComfyUI: {e}")
            return False
        
        # Find video node information
        print("Analyzing workflow to determine video output format...")
        global video_node_id, video_prefix, video_format, frame_rate
        video_node_id = None
        video_prefix = DEFAULT_VIDEO_PREFIX
        video_format = DEFAULT_VIDEO_FORMAT
        frame_rate = DEFAULT_FRAME_RATE

        for node_id, node_data in workflow.items():
            if node_data.get('class_type') == 'VHS_VideoCombine':
                video_node_id = node_id
                node_inputs = node_data.get('inputs', {})
                
                # Get filename prefix if available
                if "filename_prefix" in node_inputs:
                    video_prefix = node_inputs["filename_prefix"]
                
                # Get video format if available
                if "format" in node_inputs:
                    video_format = node_inputs["format"]
                    
                # Get frame rate if available
                if "frame_rate" in node_inputs:
                    frame_rate = node_inputs["frame_rate"]
                    
                print(f"Found video node ID: {video_node_id}")
                print(f"Video output parameters: prefix={video_prefix}, format={video_format}, frame_rate={frame_rate}")
                break

        if not video_node_id:
            print("WARNING: Could not find video output node in workflow")
            print(f"Using default parameters: prefix={video_prefix}, format={video_format}, frame_rate={frame_rate}")
        
        # Update workflow with new prompt
        if "16" in workflow and "inputs" in workflow["16"]:
            workflow["16"]["inputs"]["positive_prompt"] = video_prompt
            print("Updated workflow with new prompt")
        
        # Generate the video
        print("\nGenerating video...")
        downloaded_files = monitor_execution_and_download_video()
        
        if downloaded_files:
            # Rename the downloaded file to match the image name with .mp4 extension
            for video_file in downloaded_files:
                target_name = os.path.join(os.path.dirname(image_path), 
                                         os.path.splitext(image_filename)[0] + '.mp4')
                os.rename(video_file, target_name)
                print(f"Saved video as {target_name}")
                
            # Update the global NEXT_VIDEO_INDEX variable for the next iteration
            global NEXT_VIDEO_INDEX
            try:
                # Read the current last index
                if os.path.exists(LAST_INDEX_FILE):
                    with open(LAST_INDEX_FILE, "r") as f:
                        last_index = int(f.read().strip())
                        NEXT_VIDEO_INDEX = last_index + 1
                        print(f"Updated NEXT_VIDEO_INDEX to {NEXT_VIDEO_INDEX} for next image")
            except Exception as e:
                print(f"Warning: Could not update NEXT_VIDEO_INDEX: {e}")
                
            return True
        
        return False
    except Exception as e:
        print(f"Error processing image {image_path}: {e}")
        return False

# Print the current working directory for debugging
current_dir = os.getcwd()
print(f"Current working directory: {current_dir}")

COMFY_API_URL = "https://4yhpwidgy56cz8-8188.proxy.runpod.net"
WORKFLOW_JSON = "wanvideo_480p_I2V_example_02 (2).json"
IMAGE_PATH = "assets/img/quotes/quote_1.png"  # Path to the image used in the workflow
DOWNLOAD_DIR = "./"  # directory to save the downloaded video

# Define default video parameters
DEFAULT_VIDEO_PREFIX = "WanVideoWrapper_I2V"
DEFAULT_VIDEO_FORMAT = "video/h264-mp4"
DEFAULT_FRAME_RATE = 16  # Updated to match workflow default
LAST_INDEX_FILE = ".last_video_index"  # File to track the last index used

# Initialize the next video index (default to 20 as specified by user)
NEXT_VIDEO_INDEX = 1

# Try to read the last index from file
try:
    if os.path.exists(LAST_INDEX_FILE):
        with open(LAST_INDEX_FILE, "r") as f:
            last_index = int(f.read().strip())
            NEXT_VIDEO_INDEX = last_index + 1
            print(f"Last video index was {last_index}, will try from index {NEXT_VIDEO_INDEX}")
    else:
        print(f"No previous index found, starting from index {NEXT_VIDEO_INDEX}")
except Exception as e:
    print(f"Error reading last index: {e}. Using default index {NEXT_VIDEO_INDEX}")

# Generate a unique client ID for this session
client_id = str(uuid.uuid4())

# Function to save the latest index
def save_last_index(index):
    """Save the last successfully used index for future runs"""
    try:
        with open(LAST_INDEX_FILE, "w") as f:
            f.write(str(index))
        print(f"Saved index {index} for future runs")
    except Exception as e:
        print(f"Error saving index: {e}")

# Function to try downloading video with multiple indices
def try_download_video_with_indices(max_attempts=5):
    """Try to download the video file with multiple indices"""
    global NEXT_VIDEO_INDEX
    downloaded_files = []
    format_encoded = urllib.parse.quote(video_format)
    
    # First try the expected next index
    indices_to_try = [NEXT_VIDEO_INDEX]
    
    # Then try some surrounding indices
    for i in range(1, max_attempts):
        # Try previous indices first (more likely)
        prev_index = NEXT_VIDEO_INDEX - i
        if prev_index > 0:
            indices_to_try.append(prev_index)
        
        # Also try next indices in case there were runs we don't know about
        indices_to_try.append(NEXT_VIDEO_INDEX + i)
    
    print(f"Will try video indices in this order: {indices_to_try}")
    
    for idx in indices_to_try:
        # Format the index with leading zeros (5 digits)
        padded_index = str(idx).zfill(5)
        filename = f"{video_prefix}_{padded_index}.mp4"
        
        # Create the video URL
        video_url = f"{COMFY_API_URL}/api/viewvideo?filename={filename}&type=output&subfolder=&format={format_encoded}&frame_rate={frame_rate}"
        
        print(f"Checking for video with index {idx}: {filename}")
        try:
            # First check if the file exists with a HEAD request
            head_response = requests.head(video_url, timeout=5)
            
            if head_response.status_code == 200:
                print(f"✓ Found video file with index {idx}")
                video_path = get_video_file(filename)
                if video_path:
                    # Save this index for future runs
                    save_last_index(idx)
                    # Update the next index for subsequent iterations in this run
                    NEXT_VIDEO_INDEX = idx + 1
                    print(f"Updated NEXT_VIDEO_INDEX to {NEXT_VIDEO_INDEX}")
                    downloaded_files.append(video_path)
                    return downloaded_files
            else:
                print(f"✗ No video found with index {idx}")
        except Exception as e:
            print(f"Error checking index {idx}: {e}")
    
    return downloaded_files

# Step 1: Check if the workflow file exists
workflow_path = os.path.join(current_dir, WORKFLOW_JSON)
if not os.path.isfile(workflow_path):
    workflow_path = os.path.join(current_dir, "build", "assets", "scripts", WORKFLOW_JSON)
    if not os.path.isfile(workflow_path):
        print(f"ERROR: Could not find the workflow JSON file at {WORKFLOW_JSON}")
        print(f"Tried paths: {os.path.join(current_dir, WORKFLOW_JSON)}")
        print(f"            {workflow_path}")
        sys.exit(1)

# Step 2: Check if the image file exists
image_path = os.path.join(current_dir, IMAGE_PATH)
if not os.path.isfile(image_path):
    image_path = os.path.join(current_dir, "..", "..", IMAGE_PATH)
    if not os.path.isfile(image_path):
        print(f"ERROR: Could not find the image file at {IMAGE_PATH}")
        print(f"Tried paths: {os.path.join(current_dir, IMAGE_PATH)}")
        print(f"            {image_path}")
        sys.exit(1)

print(f"Using workflow file: {workflow_path}")
print(f"Using image file: {image_path}")

# Step 3: Load and validate the workflow JSON
try:
    with open(workflow_path, "r", encoding="utf-8") as file:
        workflow = json.load(file)
        print(f"Successfully loaded workflow with {len(workflow)} nodes")
        
        # Display resize node information
        if "66" in workflow and "inputs" in workflow["66"]:
            resize_node = workflow["66"]["inputs"]
            print(f"Image will be resized to: {resize_node.get('width', 'unknown')}x{resize_node.get('height', 'unknown')} pixels")
        
        # Display prompt information
        if "16" in workflow and "inputs" in workflow["16"]:
            prompt_node = workflow["16"]["inputs"]
            print(f"Positive prompt: {prompt_node.get('positive_prompt', 'unknown')}")
        
        # Validate video settings
        if "30" in workflow and "inputs" in workflow["30"]:
            video_node = workflow["30"]["inputs"]
            if video_node.get("frame_rate") != DEFAULT_FRAME_RATE:
                print(f"NOTE: Workflow frame rate ({video_node.get('frame_rate')}) differs from default ({DEFAULT_FRAME_RATE})")
                print("Using workflow frame rate for video generation")
except json.JSONDecodeError as e:
    print(f"ERROR: Invalid JSON in workflow file: {e}")
    sys.exit(1)
except Exception as e:
    print(f"ERROR: Failed to load workflow file: {e}")
    sys.exit(1)

# Step 4: Upload the image to the server
print(f"Uploading image to ComfyUI server...")
try:
    # Prepare the image upload request
    files = {
        'image': (os.path.basename(image_path), open(image_path, 'rb'), 'image/png')
    }
    
    # Upload the image using the correct endpoint
    upload_url = f"{COMFY_API_URL}/api/upload/image"
    upload_response = requests.post(upload_url, files=files)
    
    # Print response for debugging
    print(f"Upload response status: {upload_response.status_code}")
    
    if upload_response.status_code != 200:
        print(f"Upload response: {upload_response.text}")
        raise Exception(f"Image upload failed with status code {upload_response.status_code}")
    
    # Get the uploaded image information
    upload_result = upload_response.json()
    print(f"Image uploaded successfully: {upload_result}")
    
    # Determine the path to the uploaded image for the workflow
    uploaded_image_path = upload_result.get('name')
    if upload_result.get('subfolder'):
        uploaded_image_path = f"{upload_result['subfolder']}/{uploaded_image_path}"
    
    # Modify the workflow to use the uploaded image
    if "58" in workflow and "inputs" in workflow["58"] and "image" in workflow["58"]["inputs"]:
        workflow["58"]["inputs"]["image"] = uploaded_image_path
        print(f"Updated workflow to use uploaded image: {uploaded_image_path}")
    else:
        print("WARNING: Could not find image node in workflow to update")
    
except Exception as e:
    print(f"ERROR: Failed to upload image: {e}")
    sys.exit(1)

# Step 5: Test server connectivity
try:
    test_response = requests.get(f"{COMFY_API_URL}/system_stats", timeout=10)
    test_response.raise_for_status()
    print(f"Server is reachable. System info: {test_response.text[:100]}...")
except requests.exceptions.RequestException as e:
    print(f"ERROR: Could not connect to ComfyUI server: {e}")
    print("Please verify if the RunPod server is still running.")
    sys.exit(1)

# Step 6: Submit workflow and monitor execution
def queue_prompt(prompt):
    """Queue a prompt to the ComfyUI server using the prompt API"""
    print("Submitting workflow to ComfyUI API...")
    p = {"prompt": prompt, "client_id": client_id}
    data = json.dumps(p).encode('utf-8')
    
    try:
        # Create a request with headers
        req = urllib.request.Request(f"{COMFY_API_URL}/prompt", data=data)
        req.add_header('Content-Type', 'application/json')
        req.add_header('Accept', 'application/json')
        
        # Try with requests library for better debugging
        print("Attempting to submit with requests library...")
        response = requests.post(
            f"{COMFY_API_URL}/prompt", 
            json={"prompt": prompt, "client_id": client_id},
            headers={
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            timeout=30
        )
        
        if response.status_code == 403:
            print("ERROR: Server returned 403 Forbidden. This usually means:")
            print("1. The RunPod server is blocking API access")
            print("2. Authentication is required but not provided")
            print("3. The server's security settings don't allow this operation")
            print("\nTrying to diagnose the issue...")
            
            # Try a GET request to see if the server responds to that
            test_resp = requests.get(f"{COMFY_API_URL}/system_stats")
            if test_resp.status_code == 200:
                print("Server responds to GET requests but blocks POST requests.")
                print("This is likely a security setting on the RunPod instance.")
                print("\nPossible solutions:")
                print("1. Try using the ComfyUI web interface directly")
                print("2. Check if there's a special access token required")
                print("3. Contact the RunPod administrator for access")
            else:
                print(f"Server also blocks GET requests (status: {test_resp.status_code})")
                print("The RunPod server might be configured to only allow browser access.")
            
            sys.exit(1)
        
        if response.status_code != 200:
            print(f"ERROR: Server returned status code {response.status_code}")
            print(f"Response: {response.text}")
            sys.exit(1)
            
        return response.json()
        
    except Exception as e:
        print(f"ERROR: Failed to submit workflow: {e}")
        sys.exit(1)

def get_video_file(filename, subfolder="", file_type="output"):
    """Download a video file from the ComfyUI server"""
    # Encode the parameters
    format_encoded = urllib.parse.quote(video_format)
    
    # Create the video URL
    video_url = f"{COMFY_API_URL}/api/viewvideo?filename={filename}&type={file_type}&subfolder={subfolder}&format={format_encoded}&frame_rate={frame_rate}"
    
    print(f"Downloading video from: {video_url}")
    try:
        # Create a session to maintain cookies
        session = requests.Session()
        
        # Add browser-like headers to bypass security restrictions
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'video/webm,video/mp4,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': COMFY_API_URL,
            'Sec-Fetch-Dest': 'video',
            'Sec-Fetch-Mode': 'no-cors',
            'Sec-Fetch-Site': 'same-origin',
            'Connection': 'keep-alive',
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache',
        }
        
        # First visit the main page to get cookies
        session.get(COMFY_API_URL, headers=headers)
        
        # Download the video
        print("Using browser-like headers to bypass security restrictions...")
        response = session.get(video_url, headers=headers, stream=True, timeout=60)
        
        if response.status_code == 200:
            # Save the video to disk
            save_path = os.path.join(DOWNLOAD_DIR, filename)
            with open(save_path, "wb") as file:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        file.write(chunk)
            
            file_size_mb = os.path.getsize(save_path) / (1024 * 1024)
            print(f"✓ Successfully downloaded video {filename} ({file_size_mb:.2f} MB)")
            print(f"  Saved to: {os.path.abspath(save_path)}")
            return os.path.abspath(save_path)
        else:
            print(f"✗ Failed to download video. Status code: {response.status_code}")
            print(f"Response: {response.text[:200]}")
            return None
    except Exception as e:
        print(f"✗ Error downloading video {filename}: {e}")
        # Try an alternative approach with urllib if requests fails
        try:
            print("Trying alternative download method...")
            # Create an opener with browser-like headers
            opener = urllib.request.build_opener()
            opener.addheaders = [
                ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'),
                ('Accept', 'video/webm,video/mp4,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5'),
                ('Referer', COMFY_API_URL),
            ]
            # Install the opener
            urllib.request.install_opener(opener)
            
            # Download the video
            with urllib.request.urlopen(video_url) as response:
                video_data = response.read()
                
            # Save the video to disk
            save_path = os.path.join(DOWNLOAD_DIR, filename)
            with open(save_path, "wb") as file:
                file.write(video_data)
                
            file_size_mb = os.path.getsize(save_path) / (1024 * 1024)
            print(f"✓ Successfully downloaded video {filename} using alternative method ({file_size_mb:.2f} MB)")
            print(f"  Saved to: {os.path.abspath(save_path)}")
            return os.path.abspath(save_path)
        except Exception as e2:
            print(f"✗ Alternative method also failed: {e2}")
            return None

def get_history(prompt_id):
    """Get the execution history for a prompt"""
    try:
        url = f"{COMFY_API_URL}/history/{prompt_id}"
        with urllib.request.urlopen(url) as response:
            return json.loads(response.read())
    except Exception as e:
        print(f"Error getting history: {e}")
        return {}

def monitor_execution_and_download_video():
    """Monitor the execution of a workflow and download the resulting video"""
    print("\n==== Workflow Execution Phase ====")
    
    # Queue the prompt and get the prompt ID
    prompt_response = queue_prompt(workflow)
    prompt_id = prompt_response["prompt_id"]
    print(f"Prompt submitted successfully, ID: {prompt_id}")

    # Connect to the websocket for real-time updates
    print("Connecting to WebSocket for real-time progress updates...")
    ws_url = f"{COMFY_API_URL.replace('https://', 'wss://').replace('http://', 'ws://')}/ws?clientId={client_id}"
    print(f"WebSocket URL: {ws_url}")
    
    try:
        ws = websocket.WebSocket()
        ws.connect(ws_url)
        print("Connected to WebSocket")
        
        # Wait for the prompt to complete execution
        start_time = time.time()
        max_wait_time = 30 * 60  # 30 minutes timeout
        last_node_message = None
        completed = False
        
        print("\nWaiting for workflow to complete (this may take 5-20 minutes)...")
        while time.time() - start_time < max_wait_time and not completed:
            try:
                # Set a timeout for receiving messages
                ws.settimeout(10)
                message = ws.recv()
                
                # Process the message
                if isinstance(message, str):
                    message_data = json.loads(message)
                    
                    if message_data["type"] == "executing":
                        data = message_data["data"]
                        node_id = data.get("node")
                        
                        # If the node is None, execution is complete
                        if node_id is None and data.get("prompt_id") == prompt_id:
                            print("\n✓ Workflow execution completed!")
                            completed = True
                            break
                        
                        # Otherwise, show which node is being executed
                        if data.get("prompt_id") == prompt_id:
                            if node_id != last_node_message:
                                last_node_message = node_id
                                print(f"  - Processing node: {node_id}")
                    
                    elif message_data["type"] == "progress":
                        data = message_data["data"]
                        value = data.get("value", 0)
                        max_value = data.get("max", 100)
                        percent = (value / max_value) * 100 if max_value > 0 else 0
                        print(f"  - Progress: {percent:.1f}%")
                        
            except websocket.WebSocketTimeoutException:
                # Timeout means no message received, print a dot to show we're still alive
                elapsed_minutes = (time.time() - start_time) / 60
                print(f"  - Still waiting... (elapsed time: {elapsed_minutes:.1f} minutes)")
            except Exception as e:
                print(f"Error receiving WebSocket message: {e}")
                # Try to reconnect
                try:
                    ws.close()
                    ws = websocket.WebSocket()
                    ws.connect(ws_url)
                except:
                    print("Failed to reconnect to WebSocket")
                    break
        
        # Close the WebSocket connection
        ws.close()
        
        # If we timed out, exit
        if time.time() - start_time >= max_wait_time:
            print(f"\n✗ Timed out after waiting {max_wait_time/60:.1f} minutes")
            return []
            
        if not completed:
            print(f"\n✗ Workflow did not complete successfully")
            return []
        
        # Wait a moment for the server to finalize output files
        wait_time = 2
        print(f"Waiting {wait_time} seconds for file system updates...")
        time.sleep(wait_time)
            
        # Try to get the generated video files using the history endpoint
        downloaded_files = []
        print("\nFetching output files from workflow history...")
        
        try:
            # 1. First approach: Use the proper history endpoint
            history_url = f"{COMFY_API_URL}/history/{prompt_id}"
            history_response = requests.get(history_url, timeout=10)
            
            if history_response.status_code == 200:
                print("Successfully retrieved workflow history")
                history = history_response.json()
                
                if prompt_id in history:
                    prompt_info = history[prompt_id]
                    outputs = prompt_info.get("outputs", {})
                    
                    for node_id, node_output in outputs.items():
                        if "videos" in node_output:
                            print(f"Found {len(node_output['videos'])} video(s) in node {node_id}")
                            
                            for video_info in node_output["videos"]:
                                filename = video_info.get("filename")
                                subfolder = video_info.get("subfolder", "")
                                file_type = video_info.get("type", "output")
                                
                                print(f"Found video: {filename} (subfolder: {subfolder}, type: {file_type})")
                                
                                # Download the video with proper paths
                                video_path = get_video_file(filename, subfolder, file_type)
                                if video_path:
                                    downloaded_files.append(video_path)
                else:
                    print(f"Prompt ID {prompt_id} not found in history")
            else:
                print(f"Could not access history. Status code: {history_response.status_code}")
                if history_response.status_code == 403:
                    print("Access to history endpoint is forbidden by the server.")
                    print("This is a common security restriction on RunPod instances.")
        except Exception as e:
            print(f"Error fetching history: {e}")
        
        # If no videos found via the history endpoint, try to get the URL directly
        if not downloaded_files and video_node_id and video_prefix:
            print("\nTrying to download video with multiple indices...")
            downloaded_files = try_download_video_with_indices()
            
            if not downloaded_files:
                print("\nCould not find video with any of the tried indices.")
                print("The video might have a different naming pattern.")
                
                # Try one last approach - use the URL directly provided by the user
                print("\nTrying with hardcoded URL pattern for latest known index (19)...")
                video_url = f"{COMFY_API_URL}/api/viewvideo?filename=WanVideoWrapper_I2V_00019.mp4&type=output&subfolder=&format={urllib.parse.quote(video_format)}&frame_rate={frame_rate}"
                try:
                    head_response = requests.head(video_url, timeout=5)
                    
                    if head_response.status_code == 200:
                        print(f"✓ Found video at hardcoded URL (index 19)")
                        video_path = get_video_file("WanVideoWrapper_I2V_00019.mp4")
                        if video_path:
                            save_last_index(19)
                            # Update the next video index for subsequent iterations
                            global NEXT_VIDEO_INDEX
                            NEXT_VIDEO_INDEX = 20
                            print(f"Updated NEXT_VIDEO_INDEX to {NEXT_VIDEO_INDEX}")
                            downloaded_files.append(video_path)
                except Exception as e:
                    print(f"Error checking hardcoded URL: {e}")
        
        if not downloaded_files:
            print("\n=== VIDEO FILE NOT FOUND AUTOMATICALLY ===")
            print("The video was generated but could not be downloaded automatically.")
            print("Please follow these steps to get the video:")
            print("1. Open this URL in your browser: " + COMFY_API_URL)
            print("2. Find the generated video in the output panel (right side)")
            print("3. Right-click on the video and select 'Download'")
            print(f"4. The filename should start with '{video_prefix}'")
        
        return downloaded_files
        
    except Exception as e:
        print(f"Error in workflow execution: {e}")
        return []

if __name__ == "__main__":
    try:
        print("\n==== Starting Video Generation Process ====")
        
        # Get list of PNG files in quotes directory
        quotes_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'img', 'quotes')
        png_files = [f for f in os.listdir(quotes_dir) if f.endswith('.png')]
        
        # Filter out files that already have MP4 versions
        files_to_process = []
        for png_file in png_files:
            mp4_file = os.path.splitext(png_file)[0] + '.mp4'
            if not os.path.exists(os.path.join(quotes_dir, mp4_file)):
                files_to_process.append(png_file)
        
        print(f"\nFound {len(files_to_process)} PNG files without MP4 versions")
        
        # Process each file
        for i, png_file in enumerate(files_to_process, 1):
            print(f"\n=== Processing file {i}/{len(files_to_process)}: {png_file} ===")
            image_path = os.path.join(quotes_dir, png_file)
            
            # Step 1: Load and validate the workflow JSON
            try:
                with open(workflow_path, "r", encoding="utf-8") as file:
                    workflow = json.load(file)
                    print(f"Successfully loaded workflow with {len(workflow)} nodes")
            except Exception as e:
                print(f"ERROR: Failed to load workflow file: {e}")
                continue
            
            # Step 2: Process the image
            if process_image_to_video(image_path):
                print(f"Successfully processed {png_file}")
            else:
                print(f"Failed to process {png_file}")
            
            # Wait a bit between files to avoid rate limits
            if i < len(files_to_process):
                print("\nWaiting 10 seconds before processing next file...")
                time.sleep(10)
        
        print("\n==== Video Generation Process Complete ====")
        print(f"Processed {len(files_to_process)} files")
        
    except Exception as e:
        print(f"\n==== Error ====")
        print(f"An error occurred during the video generation process: {e}")
        print("Check the ComfyUI interface for more details.")
        print(f"ComfyUI Interface: {COMFY_API_URL}")

print("\nScript execution completed.")
