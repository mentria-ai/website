[Website](https://mentria.ai)

An open-source, community-driven content platform where users can submit and scroll through media content, updated automatically via GitHub Actions.

## Overview

This repository hosts the source code for a single-page website, where users can scroll through content submitted by the community. The website is automatically updated via GitHub Actions whenever new content is submitted.

## How It Works

- **Content Submission**: Anyone can submit content by opening a GitHub Issue using the provided issue template.
- **Issue Template Includes**:
  - **Title**
  - **Short Description** (optional)
  - **Media URL** (required): Only one URL pointing to the actual content (audio, video, or image).
  - **Tags**
  - **Wallet Address** (optional)
- **Automated Verification**: Upon issue submission, a GitHub Action runs to verify the Media URL and checks if it contains the correct media resource.
- **Content Addition**: If verification passes, the content is structured and added to the website's content via a Pull Request.
- **Automatic Merge**: If the PR passes all tests, it is automatically merged into the main branch.
- **Reward System**: Once the PR is merged and the issue is closed, the submitter automatically receives a reward through a smart contract release.

## How to Contribute

### Submitting Content

1. Navigate to the [Issues](https://github.com/mentria-ai/website/issues) tab.
2. Click on **New Issue**.
3. Select the **Content Submission** template.
4. Fill out the required fields and submit the issue.

### Developers

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Make your changes and commit them.
4. Submit a Pull Request detailing your changes.

## Getting Started Locally

1. **Clone the repository**:
   ```bash
   git clone https://github.com/mentria-ai/website
