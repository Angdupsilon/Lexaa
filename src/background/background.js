// Constants
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// Cache for API responses (key: text+rules, value: result)
const analysisCache = new Map();
const MAX_CACHE_SIZE = 100; // Limit cache size to prevent memory issues

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ANALYZE_TEXT_WITH_AI') {
        analyzeTextWithAI(message)
            .then(sendResponse)
            .catch(error => {
                console.error('AI Analysis Error:', error);
                sendResponse({ error: 'Failed to analyze text' });
            });
        return true; // Required for async sendResponse
    }
    if (message.action === 'ANALYZE_BATCH_WITH_AI') {
        analyzeBatchWithAI(message)
            .then(sendResponse)
            .catch(error => {
                console.error('AI Batch Analysis Error:', error);
                sendResponse({ error: 'Failed to analyze batch' });
            });
        return true; // Required for async sendResponse
    }
    if (message.action === 'EXTRACT_ORIGINAL_CONCEPT') {
        extractOriginalConcept(message.replacementWord)
            .then(sendResponse)
            .catch(error => {
                console.error('Concept Extraction Error:', error);
                sendResponse({ error: 'Failed to extract concept' });
            });
        return true;
    }
    if (message.action === 'GET_CURRENT_TAB_ID') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (chrome.runtime.lastError) {
                sendResponse({ error: chrome.runtime.lastError.message });
            } else if (tabs && tabs[0]) {
                sendResponse({ tabId: tabs[0].id });
            } else {
                sendResponse({ error: 'No active tab found' });
            }
        });
        return true; // Required for async sendResponse
    }
});

// Analyze text using Gemini API (legacy single-rule version, kept for backward compatibility)
async function analyzeTextWithAI({ text, originalConcept, replacementWord, ruleId }) {
    try {
        // Get API key from storage
        const result = await chrome.storage.sync.get('apiKey');
        if (!result.apiKey) {
            throw new Error('API key not set');
        }

        const prompt = constructPrompt(text, originalConcept, replacementWord);
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': result.apiKey
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 1024,
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        
        // Extract the phrases from the response
        const phrases = data.candidates[0].content.parts[0].text;
        const parsedReplacements = JSON.parse(phrases).replacements;

        console.log('Gemini response:', data);
        console.log('Parsed phrases:', parsedReplacements);

        return {
            ruleId,
            originalConcept,
            replacementWord,
            replacements: parsedReplacements
        };
    } catch (error) {
        console.error('Error in analyzeTextWithAI:', error);
        throw error;
    }
}

// Optimized batch analysis: processes multiple text blocks and all rules in one API call
async function analyzeBatchWithAI({ textBlocks, replacements }) {
    try {
        // Get API key from storage
        const result = await chrome.storage.sync.get('apiKey');
        if (!result.apiKey) {
            throw new Error('API key not set');
        }

        // Create cache key
        const cacheKey = `${textBlocks.join('|||')}|||${replacements.map(r => `${r.id}:${r.original}:${r.replacement}`).join('|||')}`;
        
        // Check cache
        if (analysisCache.has(cacheKey)) {
            console.log('Using cached result for batch analysis');
            return analysisCache.get(cacheKey);
        }

        // Combine text blocks with separators
        const combinedText = textBlocks.map((text, index) => `[Paragraph ${index + 1}]\n${text}`).join('\n\n');

        const prompt = constructBatchPrompt(combinedText, replacements);
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': result.apiKey
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 2048, // Increased for batch processing
                    responseMimeType: "application/json"
                }
            })
        });

        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        
        // Validate response structure
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
            throw new Error('Invalid API response structure');
        }
        
        // Extract the phrases from the response
        const phrases = data.candidates[0].content.parts[0].text;
        let parsedResult;
        try {
            parsedResult = JSON.parse(phrases);
        } catch (parseError) {
            console.error('Failed to parse API response as JSON:', phrases);
            throw new Error('Invalid JSON response from API');
        }

        console.log('Gemini batch response:', data);
        console.log('Parsed batch result:', parsedResult);

        // Transform result to match expected format: array of { paragraphIndex, ruleId, replacements }
        const batchResult = {
            results: Array.isArray(parsedResult.results) ? parsedResult.results : []
        };

        // Cache the result (with size limit)
        if (analysisCache.size >= MAX_CACHE_SIZE) {
            // Remove oldest entry (first in Map)
            const firstKey = analysisCache.keys().next().value;
            analysisCache.delete(firstKey);
        }
        analysisCache.set(cacheKey, batchResult);

        return batchResult;
    } catch (error) {
        console.error('Error in analyzeBatchWithAI:', error);
        throw error;
    }
}

// Construct prompt for Gemini API (single rule version)
function constructPrompt(text, originalConcept, replacementWord) {
    // Handle both old format (string) and new format (array)
    const concepts = Array.isArray(originalConcept) ? originalConcept : [originalConcept];
    const conceptDescription = concepts.length > 1 
        ? `any of these concepts: ${concepts.map(c => `"${c}"`).join(', ')}`
        : `the concept "${concepts[0]}"`;
    
    return `You are a context-aware AI trained to help users learn vocabulary by replacing concepts naturally and accurately.
  
  Your task is to analyze the given text and return **phrases that express the same meaning as ${conceptDescription}** and can be **replaced with a grammatically appropriate form** of "${replacementWord}", without disrupting meaning, flow, or factual accuracy.
  
  Text to analyze:
  """
  ${text}
  """
  
  Instructions:
  1. Identify phrases that convey the same meaning as ${conceptDescription} and that can be replaced with a **grammatically adapted form** of "${replacementWord}" (e.g., changing tense, part of speech, or form like *nostalgic → nostalgia*).
  2. Ensure the replacement preserves:
     - The **grammatical structure**
     - The **meaning** and **tone**
     - **Natural sentence flow**
  3. You may adapt the form of "${replacementWord}" to fit the context, such as:
     - noun → adjective
     - verb → noun (e.g., "excite" → "exciting")
     - past tense, pluralization, etc.
  
  Do NOT select phrases that:
  - Contain or overlap with any **dates, years, or specific time references**, including:
     - Named months or days (e.g., "April 2025", "Monday morning")
     - Phrases like "as of [date]", "in [year]", "since 2010", "during the 1990s"
     - Relative references to known dates (e.g., "post-9/11", "before the election")
    - Are **proper nouns**, including people, places, companies, organizations, or named historical events
    - Would make the sentence **less precise**, **factually inaccurate**, or **temporally vague**

  
  Output format:
  Return a JSON object with one key: **"replacements"**, containing an array of objects, each with:
  - "original_phrase": the exact phrase in the text to replace
  - "replacement_form": the adjusted form of "${replacementWord}" to insert
  
  Do not include any explanation or additional text outside the JSON.
  
  Example:
  Text: "The movie was really good and made me feel very happy. I was so happy that I couldn't stop smiling."
  Concept: "very happy"
  Replacement: "ecstatic"
  
  Output:
  {
    "replacements": [
      { "original_phrase": "very happy", "replacement_form": "ecstatic" },
      { "original_phrase": "so happy", "replacement_form": "ecstatic" }
    ]
  }
  
  Another example:
  Text: "She looked back on the past with a warm feeling."
  Concept: "warm feeling about the past"
  Replacement: "nostalgia"
  
  Output:
  {
    "replacements": [
      { "original_phrase": "a warm feeling", "replacement_form": "nostalgia" }
    ]
  }
  
  If you detect that a phrase includes a factual or temporal reference, you MUST exclude it, even if the replacement word appears semantically similar.
  Now, analyze the following text and return the result in this exact format.`;
  }

// Construct optimized batch prompt for multiple paragraphs and all rules
function constructBatchPrompt(combinedText, replacements) {
    const rulesDescription = replacements.map((rule, index) => {
        // Handle both old format (string) and new format (array)
        const concepts = Array.isArray(rule.original) ? rule.original : [rule.original];
        const conceptsList = concepts.length > 1 
            ? `concepts: ${concepts.map(c => `"${c}"`).join(', ')}`
            : `concept: "${concepts[0]}"`;
        return `${index + 1}. ${conceptsList} → Replacement word: "${rule.replacement}"`;
    }).join('\n');

    return `You are a context-aware AI trained to help users learn vocabulary by replacing concepts naturally and accurately.

Your task is to analyze the given text (which contains multiple paragraphs) and find phrases that match ANY of the replacement rules below. For each paragraph, identify phrases that can be replaced according to the rules.

Text to analyze:
"""
${combinedText}
"""

Replacement Rules:
${rulesDescription}

Instructions:
1. For each paragraph, identify phrases that convey the same meaning as any of the concepts above and can be replaced with a **grammatically adapted form** of the corresponding replacement word.
2. Ensure replacements preserve:
   - The **grammatical structure**
   - The **meaning** and **tone**
   - **Natural sentence flow**
3. You may adapt the form of replacement words to fit the context (tense, part of speech, etc.).

Do NOT select phrases that:
- Contain or overlap with dates, years, or specific time references
- Are proper nouns (people, places, companies, organizations, historical events)
- Would make the sentence less precise, factually inaccurate, or temporally vague

Output format:
Return a JSON object with one key: **"results"**, containing an array of objects, each with:
- "paragraph_index": the paragraph number (0-based, matching [Paragraph X] markers)
- "rule_id": the ID of the matching rule
- "original_phrase": the exact phrase in the text to replace
- "replacement_form": the adjusted form of the replacement word to insert

Example:
{
  "results": [
    { "paragraph_index": 0, "rule_id": "123", "original_phrase": "very happy", "replacement_form": "ecstatic" },
    { "paragraph_index": 0, "rule_id": "123", "original_phrase": "so happy", "replacement_form": "ecstatic" },
    { "paragraph_index": 1, "rule_id": "456", "original_phrase": "a warm feeling", "replacement_form": "nostalgia" }
  ]
}

Return only the JSON, no additional text.`;
}
  
  
// Extract original concept using Gemini (returns multiple concepts)
async function extractOriginalConcept(replacementWord) {
    try {
        const result = await chrome.storage.sync.get('apiKey');
        if (!result.apiKey) {
            throw new Error('API key not set');
        }
        const prompt = `You are a language analysis AI. Given the word or phrase "${replacementWord}", identify up to 10 of the most common English words, phrases, synonyms, or concepts it could replace in everyday text. Include both single words AND multi-word phrases. Return a JSON array of strings, with no explanation or extra text.

Important: Include a mix of:
- Single words (e.g., "happy", "joyful")
- Common phrases (e.g., "very happy", "so happy", "extremely happy")
- Idiomatic expressions when relevant

Example: For "ecstatic", return: ["happy", "very happy", "so happy", "extremely happy", "really happy", "overjoyed", "thrilled", "delighted", "elated", "over the moon"]
Example: For "nostalgia", return: ["warm feeling", "warm feeling about the past", "feeling of longing", "sentimental yearning", "homesickness", "yearning", "longing", "sentimentality", "reminiscence", "wistfulness"]

Return format: ["concept1", "concept2", "concept3", ...] (up to 10 items)`;
        const response = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': result.apiKey
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.1,
                    topK: 1,
                    topP: 1,
                    maxOutputTokens: 512, // Increased to accommodate up to 10 concepts including phrases
                    responseMimeType: "application/json"
                }
            })
        });
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        const data = await response.json();
        
        // Extract the JSON array from the response
        let conceptsText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        
        // Remove quotes if the entire response is wrapped in quotes
        if (conceptsText && conceptsText.startsWith('"') && conceptsText.endsWith('"')) {
            conceptsText = conceptsText.slice(1, -1);
            // Unescape any escaped quotes
            conceptsText = conceptsText.replace(/\\"/g, '"');
        }
        
        // Parse the JSON array
        let concepts = [];
        try {
            concepts = JSON.parse(conceptsText);
            // Ensure it's an array
            if (!Array.isArray(concepts)) {
                // If it's a single string, wrap it in an array
                concepts = [concepts];
            }
            // Filter out any invalid entries and trim strings
            concepts = concepts.filter(c => typeof c === 'string' && c.trim().length > 0)
                              .map(c => c.trim());
        } catch (parseError) {
            console.error('Failed to parse concepts array:', conceptsText, parseError);
            // Fallback: try to extract as a single concept
            concepts = [conceptsText];
        }
        
        // If we got no valid concepts, return at least the original text as fallback
        if (concepts.length === 0) {
            console.warn('No concepts extracted, using fallback');
            concepts = [replacementWord];
        }
        
        console.log('Extracted concepts:', concepts);
        return { originalConcepts: concepts };
    } catch (error) {
        console.error('Error in extractOriginalConcept:', error);
        throw error;
    }
}

//removeBtn.innerHTML = '<i class="fa fa-trash"></i>';
