import requests
import json
import time
import os
import sys
import base64
import urllib.parse

# Print the current working directory for debugging
current_dir = os.getcwd()
print(f"Current working directory: {current_dir}")

COMFY_API_URL = "https://yk7p50l28ydnsm-8188.proxy.runpod.net"
WORKFLOW_JSON = "wanvideo_480p_I2V_example_02 (2).json"
IMAGE_PATH = "assets/img/quotes/quote_61.png"  # Path to the image used in the workflow
DOWNLOAD_DIR = "./"  # directory to save the downloaded video

# Define default video parameters
DEFAULT_VIDEO_PREFIX = "WanVideoWrapper_I2V"
DEFAULT_VIDEO_FORMAT = "video/h264-mp4"
DEFAULT_FRAME_RATE = 30

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
    with open(workflow_path, "r") as file:
        workflow = json.load(file)
    print(f"Successfully loaded workflow with {len(workflow)} nodes")
    
    # Display resize node information
    if "66" in workflow and "inputs" in workflow["66"]:
        resize_node = workflow["66"]["inputs"]
        print(f"Image will be resized to: {resize_node.get('width', 'unknown')}x{resize_node.get('height', 'unknown')} pixels")
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

# Step 6: Submit workflow
try:
    print("Submitting workflow to ComfyUI API...")
    response = requests.post(
        f"{COMFY_API_URL}/prompt", 
        json={"prompt": workflow},
        timeout=30
    )
    
    # Print detailed error information if request fails
    if response.status_code != 200:
        print(f"ERROR: API request failed with status code {response.status_code}")
        print(f"Response body: {response.text}")
        sys.exit(1)
        
    prompt_response = response.json()
    prompt_id = prompt_response["prompt_id"]
    print(f"Prompt submitted successfully, ID: {prompt_id}")
    
except requests.exceptions.RequestException as e:
    print(f"ERROR: Failed to submit workflow: {e}")
    sys.exit(1)
except Exception as e:
    print(f"ERROR: Unexpected error: {e}")
    sys.exit(1)

# Step 7: Find video node information
print("Analyzing workflow to determine video output format...")
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

# Step 8: Wait for workflow execution and check for output
print("\n==== Workflow Execution Phase ====")
print("Waiting for workflow to complete (this may take 5-20 minutes)...")
print(f"Prompt ID: {prompt_id}")

# Set timeout parameters
max_wait_time = 30 * 60  # 30 minutes total
start_time = time.time()
check_interval = 10  # seconds between checks

# Check if we need to encode parameters in the URL
format_encoded = urllib.parse.quote(video_format)

# List to store potential output filenames
potential_filenames = []

# Generate a list of potential output filenames (with different indices)
for i in range(20):  # Check up to 20 different indices
    padded_index = str(i).zfill(5)
    potential_filenames.append(f"{video_prefix}_{padded_index}.mp4")

# Try a direct download using the known URL pattern format first
print("\n==== Trying Direct Video Download ====")
downloaded_files = []

elapsed_time = 0
while elapsed_time < max_wait_time and not downloaded_files:
    elapsed_minutes = elapsed_time / 60
    print(f"\nChecking for output files (elapsed time: {elapsed_minutes:.1f} minutes)...")
    
    for filename in potential_filenames:
        # Create the video URL using the format from the user example
        video_url = f"{COMFY_API_URL}/api/viewvideo?filename={filename}&type=output&subfolder=&format={format_encoded}&frame_rate={frame_rate}"
        
        print(f"Checking: {filename}")
        try:
            # First check if the file exists with a HEAD request
            head_response = requests.head(video_url, timeout=5)
            
            if head_response.status_code == 200:
                print(f"✓ Found video file: {filename}")
                print(f"URL: {video_url}")
                
                # Download the file
                try:
                    print(f"Downloading {filename}...")
                    download_response = requests.get(video_url, timeout=30)
                    
                    if download_response.status_code == 200:
                        save_path = os.path.join(DOWNLOAD_DIR, filename)
                        with open(save_path, "wb") as file:
                            file.write(download_response.content)
                        
                        file_size_mb = os.path.getsize(save_path) / (1024 * 1024)
                        print(f"✓ Successfully downloaded {filename} ({file_size_mb:.2f} MB)")
                        print(f"  Saved to: {os.path.abspath(save_path)}")
                        downloaded_files.append(save_path)
                    else:
                        print(f"✗ Failed to download {filename}, status: {download_response.status_code}")
                except Exception as e:
                    print(f"✗ Error downloading {filename}: {e}")
            else:
                print(f"✗ File not found: {filename}")
        except Exception as e:
            print(f"✗ Error checking {filename}: {e}")
    
    if downloaded_files:
        break
        
    # Only check again if no files were found
    if not downloaded_files:
        print(f"\nNo output files found yet. Waiting {check_interval} seconds before next check...")
        time.sleep(check_interval)
        elapsed_time = time.time() - start_time
    
    # Provide a progress update
    if elapsed_time > 300:  # After 5 minutes, show every filename we're checking
        print("\nWe're checking these filenames:")
        for i, fname in enumerate(potential_filenames[:5]):
            print(f"  {i+1}. {fname}")
        print("  ... and more with higher indices")

# Check if we found any output files
if downloaded_files:
    print("\n==== Success ====")
    print(f"Successfully downloaded {len(downloaded_files)} file(s):")
    for file_path in downloaded_files:
        print(f"  - {file_path}")
    
    print("\nVideo generation process completed successfully.")
else:
    print("\n==== No Files Found ====")
    print(f"No output files found after waiting {elapsed_time/60:.1f} minutes.")
    print("The workflow might still be processing or may have failed.")
    print("You can manually check for videos using the URL pattern:")
    example_url = f"{COMFY_API_URL}/api/viewvideo?filename={video_prefix}_00008.mp4&type=output&subfolder=&format={format_encoded}&frame_rate={frame_rate}"
    print(f"Example: {example_url}")
    
    # Print a friendly message about where to check
    print("\nTIP: You can check the ComfyUI web interface to see the status of your workflow.")
    print(f"ComfyUI Interface: {COMFY_API_URL}")

print("\nScript execution completed.")
