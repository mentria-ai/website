/**
 * Repository context analysis for GitHub Actions assistants
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Define file extensions to include/exclude
const CODE_EXTENSIONS = [
  // Web
  '.js', '.jsx', '.ts', '.tsx', '.html', '.css', '.scss', '.json', '.vue', '.svelte',
  // Backend
  '.py', '.rb', '.php', '.java', '.go', '.cs', '.cpp', '.c', '.h', '.rs', '.scala',
  // Configuration
  '.yml', '.yaml', '.toml', '.ini', '.xml', '.md', '.mdx', '.sh', '.bat', '.ps1',
  // Data
  '.sql', '.graphql', '.prisma', '.proto'
];

// Define file patterns to exclude
const EXCLUDE_PATTERNS = [
  // Build outputs and dependencies
  'node_modules', 'dist', 'build', 'coverage', 'vendor', '__pycache__', 
  '.git', '.cache', '.vscode', '.idea',
  // Large generated files
  'package-lock.json', 'yarn.lock', 'Gemfile.lock',
  // Media files
  '.jpg', '.jpeg', '.png', '.gif', '.svg', '.ico', '.webp', '.mp4', '.webm', '.mp3', '.wav',
  '.ttf', '.woff', '.woff2', '.eot', '.pdf', '.zip', '.tar.gz'
];

/**
 * Determine if content requires repository context
 * @param {string} contentText - Issue/discussion content
 * @param {string} apiKey - Together AI API key
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {Promise<object>} - Analysis result
 */
async function needsRepositoryContext(contentText, apiKey, logFile, logger) {
  logger.logSection(logFile, "Repository Context Analysis");
  
  if (!contentText || !apiKey) {
    logger.logError(logFile, "Missing content or API key for context analysis");
    return { needsContext: false, reason: "Missing required parameters" };
  }
  
  // First, check for simple heuristics before calling the LLM
  const containsCodeRequest = /code|implement|fix|bug|error|feature|function|class|method|api|endpoint|route|component|module|import|require|package|dependency|library/i.test(contentText);
  const containsFileReference = /file|\.js|\.ts|\.py|\.rb|\.go|\.java|\.cs|\.php|\.html|\.css|\.jsx|\.tsx|\.yml|\.yaml|\.json|\.md|\.txt/i.test(contentText);
  const containsRepoQuestions = /repository|repo|codebase|project structure|directory|folder structure|architecture/i.test(contentText);
  
  // Log the heuristic analysis
  logger.logMessage(logFile, "Heuristic analysis:");
  logger.logMessage(logFile, `- Contains code-related terms: ${containsCodeRequest}`);
  logger.logMessage(logFile, `- Contains file references: ${containsFileReference}`);
  logger.logMessage(logFile, `- Contains repository questions: ${containsRepoQuestions}`);
  
  // If simple heuristics suggest we need context, query the LLM for a more precise determination
  if (containsCodeRequest || containsFileReference || containsRepoQuestions) {
    logger.logMessage(logFile, "Preliminary heuristics suggest repository context may be needed");
    
    try {
      // Create a directory for API responses
      if (!fs.existsSync('context_analysis')) {
        fs.mkdirSync('context_analysis', { recursive: true });
      }
      
      // Prepare API call payload
      const requestPayload = {
        model: "deepseek-ai/DeepSeek-R1",
        messages: [
          {
            role: "system",
            content: "You are a tool that analyzes GitHub issue or discussion messages to determine if repository context would be helpful to answer the query. Respond with only a JSON object containing two fields: 'needsContext' (boolean) and 'reason' (string)."
          },
          {
            role: "user",
            content: `Analyze this GitHub issue/discussion text and determine if repository code context would be helpful to answer it properly:\n\n${contentText}\n\nRespond with JSON only, format: {"needsContext": boolean, "reason": "your explanation"}`
          }
        ]
      };
      
      // Save payload for debugging
      fs.writeFileSync('context_analysis/request.json', JSON.stringify(requestPayload, null, 2));
      
      // Call the API
      logger.logMessage(logFile, "Calling Together AI to determine if context is needed");
      const curlCommand = `curl -s -X POST "https://api.together.xyz/v1/chat/completions" -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d @context_analysis/request.json -o context_analysis/response.json`;
      
      execSync(curlCommand);
      
      // Parse response
      if (fs.existsSync('context_analysis/response.json')) {
        const responseData = JSON.parse(fs.readFileSync('context_analysis/response.json', 'utf8'));
        
        if (responseData.choices && responseData.choices.length > 0) {
          let responseContent = responseData.choices[0].message.content;
          
          // Try to extract JSON data from the response if it's wrapped in text
          let jsonMatch = responseContent.match(/\{.*\}/s);
          if (jsonMatch) {
            responseContent = jsonMatch[0];
          }
          
          try {
            const analysis = JSON.parse(responseContent);
            logger.logSuccess(logFile, `Analysis completed: needsContext=${analysis.needsContext}, reason="${analysis.reason}"`);
            return analysis;
          } catch (jsonError) {
            logger.logError(logFile, `Failed to parse JSON from response: ${jsonError.message}`);
            logger.logMessage(logFile, `Raw response content: ${responseContent}`);
          }
        } else {
          logger.logError(logFile, "Invalid API response format");
        }
      } else {
        logger.logError(logFile, "No response file generated from API call");
      }
    } catch (error) {
      logger.logError(logFile, `Error during context analysis: ${error.message}`);
    }
    
    // Default to true if the API call fails but heuristics suggested context might be needed
    return { needsContext: true, reason: "Heuristic match, API verification failed" };
  }
  
  // If heuristics don't suggest context is needed, return false
  logger.logMessage(logFile, "Heuristics suggest repository context is not needed");
  return { needsContext: false, reason: "No code or repository related patterns detected" };
}

/**
 * Get repository structure and relevant files based on issue content
 * @param {string} contentText - Issue/discussion content
 * @param {string} apiKey - Together AI API key
 * @param {string} repoRoot - Root path to repository
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {Promise<object>} - Repository context
 */
async function getRepositoryContext(contentText, apiKey, repoRoot, logFile, logger) {
  logger.logSection(logFile, "Repository Context Extraction");
  
  // Step 1: Generate a basic repository structure
  logger.logMessage(logFile, "Generating basic repository structure");
  const repoStructure = await getBasicRepositoryStructure(repoRoot, logFile, logger);
  
  // Step 2: Analyze content to identify relevant files
  logger.logMessage(logFile, "Identifying relevant files based on content");
  const relevantFiles = await identifyRelevantFiles(contentText, repoStructure, apiKey, logFile, logger);
  
  // Step 3: Read the content of relevant files
  logger.logMessage(logFile, `Reading content from ${relevantFiles.length} relevant files`);
  const fileContents = await readRelevantFiles(relevantFiles, repoRoot, logFile, logger);
  
  // Prepare the context object
  const context = {
    structure: repoStructure,
    relevantFiles: relevantFiles,
    fileContents: fileContents
  };
  
  // Save context for future reference
  fs.writeFileSync('context_analysis/repository_context.json', JSON.stringify(context, null, 2));
  logger.logSuccess(logFile, `Repository context saved with ${fileContents.length} files`);
  
  return context;
}

/**
 * Get basic repository structure
 * @param {string} repoRoot - Root path to repository
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {Promise<object>} - Repository structure
 */
async function getBasicRepositoryStructure(repoRoot, logFile, logger) {
  try {
    // Get top-level directories and important files
    const getTopLevelCommand = `find "${repoRoot}" -maxdepth 2 -type d -not -path "*/\\.*" -not -path "*/node_modules*" -not -path "*/dist*" -not -path "*/build*" | sort`;
    const topLevelDirs = execSync(getTopLevelCommand).toString().trim().split('\n');
    
    // Format the structure data
    const structure = {
      rootPath: repoRoot,
      topLevelDirectories: topLevelDirs.map(dir => path.relative(repoRoot, dir)),
      importantFiles: []
    };
    
    // Find important root level files
    const rootFilesCommand = `find "${repoRoot}" -maxdepth 1 -type f -name "*.json" -o -name "*.md" -o -name "*.yml" -o -name "*.yaml" -o -name "*.config.*" | sort`;
    const rootFiles = execSync(rootFilesCommand).toString().trim().split('\n');
    if (rootFiles.length > 0 && rootFiles[0] !== '') {
      structure.importantFiles = rootFiles.map(file => path.relative(repoRoot, file));
    }
    
    logger.logSuccess(logFile, `Repository structure extracted: ${structure.topLevelDirectories.length} directories, ${structure.importantFiles.length} important root files`);
    return structure;
  } catch (error) {
    logger.logError(logFile, `Error generating repository structure: ${error.message}`);
    return {
      rootPath: repoRoot,
      topLevelDirectories: [],
      importantFiles: [],
      error: error.message
    };
  }
}

/**
 * Identify relevant files based on content analysis
 * @param {string} contentText - Issue/discussion content
 * @param {object} repoStructure - Repository structure
 * @param {string} apiKey - Together AI API key
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {Promise<array>} - List of relevant file paths
 */
async function identifyRelevantFiles(contentText, repoStructure, apiKey, logFile, logger) {
  try {
    // Create a directory for API responses
    if (!fs.existsSync('context_analysis')) {
      fs.mkdirSync('context_analysis', { recursive: true });
    }
    
    // Generate a more detailed file listing for analysis
    const rootPath = repoStructure.rootPath;
    const excludePatterns = EXCLUDE_PATTERNS.map(pattern => `-not -path "*/${pattern}*"`).join(' ');
    const extensionPatterns = CODE_EXTENSIONS.map(ext => `-name "*${ext}"`).join(' -o ');
    
    const listFilesCommand = `find "${rootPath}" -type f \\( ${extensionPatterns} \\) ${excludePatterns} | sort`;
    const allFiles = execSync(listFilesCommand).toString().trim().split('\n');
    
    // Filter out empty entries and get relative paths
    const fileList = allFiles
      .filter(file => file && file.trim() !== '')
      .map(file => path.relative(rootPath, file));
    
    logger.logMessage(logFile, `Found ${fileList.length} potential code files in repository`);
    
    // Save file list for LLM analysis
    fs.writeFileSync('context_analysis/file_list.txt', fileList.join('\n'));
    
    // Prepare API call payload
    const requestPayload = {
      model: "deepseek-ai/DeepSeek-R1",
      messages: [
        {
          role: "system",
          content: "You are a tool that analyzes GitHub issues and selects the most relevant files from a repository to provide context for answering. Return a JSON array of maximum 10 file paths, prioritizing files that are most relevant to understanding and addressing the issue."
        },
        {
          role: "user",
          content: `Based on this GitHub issue or discussion text, select the most relevant files from the repository file list to help answer the query effectively.

Issue/Discussion text:
${contentText}

Repository file list:
${fileList.slice(0, 500).join('\n')}${fileList.length > 500 ? '\n...[additional files truncated]' : ''}

Return a JSON array containing only the paths of up to 10 most relevant files. Format: ["path/to/file1", "path/to/file2", ...]. If you can't find relevant files, return an empty array.`
        }
      ]
    };
    
    // Save payload for debugging
    fs.writeFileSync('context_analysis/file_request.json', JSON.stringify(requestPayload, null, 2));
    
    // Call the API
    logger.logMessage(logFile, "Calling Together AI to identify relevant files");
    const curlCommand = `curl -s -X POST "https://api.together.xyz/v1/chat/completions" -H "Authorization: Bearer ${apiKey}" -H "Content-Type: application/json" -d @context_analysis/file_request.json -o context_analysis/file_response.json`;
    
    execSync(curlCommand);
    
    // Parse response
    if (fs.existsSync('context_analysis/file_response.json')) {
      const responseData = JSON.parse(fs.readFileSync('context_analysis/file_response.json', 'utf8'));
      
      if (responseData.choices && responseData.choices.length > 0) {
        let responseContent = responseData.choices[0].message.content;
        
        // Try to extract JSON array from the response
        let jsonMatch = responseContent.match(/\[.*\]/s);
        if (jsonMatch) {
          try {
            const relevantFiles = JSON.parse(jsonMatch[0]);
            logger.logSuccess(logFile, `Successfully identified ${relevantFiles.length} relevant files`);
            
            // Verify files exist
            const existingFiles = relevantFiles.filter(file => {
              const exists = fs.existsSync(path.join(rootPath, file));
              if (!exists) {
                logger.logWarning(logFile, `Identified file doesn't exist: ${file}`);
              }
              return exists;
            });
            
            return existingFiles;
          } catch (jsonError) {
            logger.logError(logFile, `Failed to parse JSON from response: ${jsonError.message}`);
          }
        } else {
          logger.logError(logFile, "No JSON array found in response");
        }
      }
    }
    
    // Fallback to a simpler approach if API fails
    logger.logWarning(logFile, "API file selection failed, falling back to heuristic selection");
    return fallbackFileSelection(contentText, fileList, logFile, logger);
  } catch (error) {
    logger.logError(logFile, `Error identifying relevant files: ${error.message}`);
    return [];
  }
}

/**
 * Fallback method to select relevant files based on simple heuristics
 * @param {string} contentText - Issue/discussion content
 * @param {array} fileList - List of all files
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {array} - List of relevant file paths
 */
function fallbackFileSelection(contentText, fileList, logFile, logger) {
  // Extract keywords from content
  const keywords = contentText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 3)
    .filter(word => !['this', 'that', 'than', 'then', 'when', 'what', 'where', 'which', 'with'].includes(word));
  
  logger.logMessage(logFile, `Extracted ${keywords.length} keywords for heuristic matching`);
  
  // Score files based on keyword matches in path
  const scoredFiles = fileList.map(file => {
    const fileLower = file.toLowerCase();
    let score = 0;
    
    // Check for exact filename matches
    const fileName = path.basename(file);
    if (contentText.toLowerCase().includes(fileName.toLowerCase())) {
      score += 10;
    }
    
    // Check for matching extensions
    const ext = path.extname(file);
    if (contentText.toLowerCase().includes(ext.toLowerCase())) {
      score += 5;
    }
    
    // Check for keyword matches in path
    keywords.forEach(keyword => {
      if (fileLower.includes(keyword)) {
        score += 3;
      }
    });
    
    // Prioritize non-test files
    if (!/test|spec|mock/i.test(fileLower)) {
      score += 1;
    }
    
    // Prioritize certain important files
    if (/^(package\.json|tsconfig\.json|README\.md|.+\.config\..+)$/i.test(fileName)) {
      score += 2;
    }
    
    return { file, score };
  });
  
  // Sort by score and take top results
  const selectedFiles = scoredFiles
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .filter(item => item.score > 0)
    .map(item => item.file);
  
  logger.logSuccess(logFile, `Heuristic selection found ${selectedFiles.length} relevant files`);
  return selectedFiles;
}

/**
 * Read content from relevant files
 * @param {array} filePaths - List of file paths
 * @param {string} repoRoot - Root path to repository
 * @param {string} logFile - Path to log file
 * @param {object} logger - Logger utility
 * @returns {Promise<array>} - Array of file content objects
 */
async function readRelevantFiles(filePaths, repoRoot, logFile, logger) {
  const fileContents = [];
  
  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(repoRoot, filePath);
      
      // Check if file exists and is not too large
      if (fs.existsSync(fullPath)) {
        const stats = fs.statSync(fullPath);
        const fileSizeKB = stats.size / 1024;
        
        // Skip files larger than 500KB
        if (fileSizeKB > 500) {
          logger.logWarning(logFile, `Skipping file too large (${fileSizeKB.toFixed(2)}KB): ${filePath}`);
          continue;
        }
        
        // Read file content
        const content = fs.readFileSync(fullPath, 'utf8');
        
        fileContents.push({
          path: filePath,
          language: getLanguageFromPath(filePath),
          content: content,
          size: stats.size
        });
        
        logger.logMessage(logFile, `Read file (${fileSizeKB.toFixed(2)}KB): ${filePath}`);
      } else {
        logger.logWarning(logFile, `File not found: ${filePath}`);
      }
    } catch (error) {
      logger.logError(logFile, `Error reading file ${filePath}: ${error.message}`);
    }
  }
  
  return fileContents;
}

/**
 * Determine language from file path
 * @param {string} filePath - Path to the file
 * @returns {string} - Language identifier
 */
function getLanguageFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  
  const languageMap = {
    '.js': 'javascript',
    '.jsx': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.json': 'json',
    '.md': 'markdown',
    '.py': 'python',
    '.rb': 'ruby',
    '.php': 'php',
    '.java': 'java',
    '.go': 'go',
    '.cs': 'csharp',
    '.cpp': 'cpp',
    '.c': 'c',
    '.h': 'c',
    '.rs': 'rust',
    '.scala': 'scala',
    '.yml': 'yaml',
    '.yaml': 'yaml',
    '.sh': 'bash',
    '.bat': 'batch',
    '.ps1': 'powershell',
    '.sql': 'sql',
    '.graphql': 'graphql',
    '.vue': 'vue',
    '.svelte': 'svelte'
  };
  
  return languageMap[ext] || 'plaintext';
}

/**
 * Format repository context as a string for inclusion in prompts
 * @param {object} repoContext - Repository context object
 * @returns {string} - Formatted context string
 */
function formatRepositoryContext(repoContext) {
  if (!repoContext || !repoContext.fileContents || repoContext.fileContents.length === 0) {
    return '';
  }
  
  let contextText = '## Repository Context\n\n';
  
  // Add high-level structure info
  contextText += '### Repository Structure\n';
  contextText += 'Key directories:\n';
  contextText += repoContext.structure.topLevelDirectories.slice(0, 10).map(dir => `- ${dir}`).join('\n');
  contextText += '\n\n';
  
  // Add file contents
  contextText += '### Relevant Files\n\n';
  
  repoContext.fileContents.forEach(file => {
    contextText += `#### ${file.path}\n`;
    contextText += '```' + file.language + '\n';
    contextText += file.content;
    if (!file.content.endsWith('\n')) contextText += '\n';
    contextText += '```\n\n';
  });
  
  return contextText;
}

module.exports = {
  needsRepositoryContext,
  getRepositoryContext,
  formatRepositoryContext
}; 